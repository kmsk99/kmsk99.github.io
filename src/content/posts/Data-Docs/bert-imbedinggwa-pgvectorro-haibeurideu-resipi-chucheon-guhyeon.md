---
tags:
  - AI
  - pgvector
  - BERT
  - Supabase
  - Recommendation
  - NextJs
title: BERT 임베딩과 pgvector로 하이브리드 레시피 추천 구현
created: '2024-11-10 10:00'
modified: '2024-11-10 15:00'
---

# 배경

"냉장고에 있는 재료로 뭘 해먹을 수 있을까"라는 문제를 풀기 위해 레시피 추천 시스템을 만들었다. 단순히 재료명이 일치하는 레시피를 찾는 것만으로는 부족하다. "소고기"를 입력했을 때 "쇠고기"나 "한우"가 들어간 레시피도 찾아야 한다. 이를 위해 BERT 임베딩 기반 시맨틱 검색과 정확 재료 매칭을 결합한 하이브리드 추천 시스템을 구현했다.

데이터는 만개의 레시피에서 수집했고, Supabase PostgreSQL에 pgvector 확장을 활성화해 벡터 저장과 유사도 검색을 처리한다.

# 아키텍처

추천 요청이 들어오면 두 경로가 `Promise.all`로 병렬 실행된다.

1. 임베딩 경로: 사용자 재료의 BERT 벡터 평균 → pgvector 코사인 유사도 검색
2. 매칭 경로: 재료명 정확 일치 기반 다중 요소 스코어링

두 결과를 합산해 최종 점수를 매긴다.

# 임베딩 경로

## BERT 벡터 준비

각 재료에 대해 사전에 BERT 모델로 768차원 임베딩을 생성해 `ingredients` 테이블의 `embedding` 컬럼에 저장해두었다. 사용자가 재료를 선택하면 해당 임베딩을 DB에서 가져온다.

```ts
async function getIngredientsEmbeddings(ingredientNames: string[]) {
  const { data } = await supabase
    .from('ingredients')
    .select('name, embedding')
    .in('name', ingredientNames);

  return data?.map(item => ({
    name: item.name,
    embedding: typeof item.embedding === 'string'
      ? JSON.parse(item.embedding)
      : item.embedding,
  })) ?? [];
}
```

## 평균 임베딩 계산

여러 재료의 임베딩을 평균 내어 하나의 "쿼리 벡터"를 만든다. L2 정규화를 거쳐 코사인 유사도 계산에 적합한 형태로 변환한다.

```ts
function calculateAverageEmbedding(embeddings: number[][]): number[] {
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
  return avg;
}

function normalizeEmbedding(embedding: number[]): number[] {
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? embedding.map(v => v / norm) : embedding;
}
```

## pgvector RPC 호출

Supabase RPC `match_recipes`로 코사인 유사도 검색을 수행한다. 결과가 5개 미만이면 임계값을 0.1씩 낮춰 재시도한다.

```ts
async function findSimilarRecipes(embedding: number[], limit: number = 20) {
  let currentThreshold = 0.6;
  let results: Recipe[] = [];

  while (currentThreshold >= 0.3 && results.length < 5) {
    const { data } = await supabase.rpc('match_recipes', {
      query_embedding: embedding,
      match_threshold: currentThreshold,
      match_count: limit,
    });
    if (data) results = data;
    if (results.length < 5) currentThreshold -= 0.1;
    else break;
  }
  return results;
}
```

RPC 내부에서는 pgvector의 `<=>` 연산자로 코사인 거리를 계산한다.

```sql
CREATE FUNCTION match_recipes(
  query_embedding vector(768),
  match_threshold float,
  match_count int
) RETURNS TABLE (id text, title text, similarity float)
AS $$
  SELECT r.id, r.title, 1 - (r.embedding <=> query_embedding) AS similarity
  FROM recipes r
  WHERE 1 - (r.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
```

# 매칭 경로

정확 재료 매칭에서는 세 가지 요소를 가중합산한다.

```ts
const matchRatio = matchCount / Math.max(totalUserIngredients, totalRecipeIngredients);
const userIngredientCoverage = matchCount / totalUserIngredients;
const recipeIngredientCoverage = matchCount / totalRecipeIngredients;

const weightedScore = (
  matchRatio * 0.4 +
  userIngredientCoverage * 0.35 +
  recipeIngredientCoverage * 0.25
);
```

- matchRatio (40%): 전체 재료 대비 일치 비율. 재료가 많이 겹칠수록 높다.
- userIngredientCoverage (35%): 사용자가 입력한 재료가 얼마나 활용되는지. 남는 재료를 줄이는 방향.
- recipeIngredientCoverage (25%): 레시피를 완성하는 데 얼마나 충분한지. 추가 구매가 적을수록 높다.

# 하이브리드 합산

두 경로의 결과를 레시피 ID 기준으로 병합하고, 교차 점수를 계산한다. 임베딩 결과에는 매칭 점수를, 매칭 결과에는 임베딩 점수를 추가로 구한다.

```ts
const [embeddingResults, basicResults] = await Promise.all([
  findSimilarRecipes(normalizedEmbedding, 20),
  recommendRecipesByBasicMatching(ingredientNames, 20),
]);

const allRecipes = new Map<string, HybridResult>();

for (const recipe of embeddingResults) {
  const basicScore = await calculateBasicScoreForRecipe(recipe.id, ingredientNames);
  allRecipes.set(recipe.id, {
    ...recipe,
    finalScore: (recipe.similarity * 0.5) + (basicScore * 0.5),
  });
}

for (const recipe of basicResults) {
  if (!allRecipes.has(recipe.id)) {
    const embeddingScore = await calculateEmbeddingScoreForRecipe(recipe.id, normalizedEmbedding);
    allRecipes.set(recipe.id, {
      ...recipe,
      finalScore: (embeddingScore * 0.5) + (recipe.score * 0.5),
    });
  }
}

return Array.from(allRecipes.values())
  .sort((a, b) => b.finalScore - a.finalScore)
  .slice(0, 20);
```

최종 점수는 `embeddingScore × 0.5 + basicScore × 0.5`다. 두 경로 모두에 등장하는 레시피는 자연스럽게 점수가 높아진다.

# 재료 자동완성

재료 입력 시 DB에 존재하는 재료명으로 자동완성을 제공한다. Supabase의 `ilike` 필터로 부분 일치 검색을 하고, 레시피에서의 사용 빈도순으로 정렬한다.

```ts
export async function searchIngredients(options: { search?: string; limit?: number }) {
  let query = supabase
    .from('ingredients')
    .select('id, name, recipe_ingredients!inner(recipe_id)');

  if (options.search) {
    query = query.ilike('name', `%${options.search}%`);
  }

  const { data } = await query.order('name').range(0, (options.limit || 100) - 1);

  return data?.map(item => ({
    name: item.name,
    count: item.recipe_ingredients.length,
  })).sort((a, b) => b.count - a.count) ?? [];
}
```

한글 입력의 경우 `onCompositionStart`/`onCompositionEnd` 이벤트로 IME 조합 중에는 검색을 보류하고, 조합이 끝난 시점에 요청을 보낸다.

# 결과

"닭가슴살, 양파, 간장"을 입력하면 임베딩 경로에서는 "닭고기"나 "치킨"이 들어간 유사 레시피까지 찾아내고, 매칭 경로에서는 정확히 세 재료를 모두 사용하는 레시피를 우선한다. 두 결과가 합산되면서 의미적으로 관련 있으면서도 실제로 만들 수 있는 레시피가 상위에 오른다.

# Reference

- https://supabase.com/docs/guides/ai/vector-columns
- https://github.com/pgvector/pgvector
- https://huggingface.co/docs/transformers/model_doc/bert

# 연결문서

- [Firestore에서 키워드 인덱싱으로 검색 구현하기](/post/firestoreeseo-kiwodeu-indeksingeuro-geomsaek-guhyeonhagi)
- [Supabase 병렬 호출 제한 유틸 구현](/post/supabase-byeongnyeol-hochul-jehan-yutil-guhyeon)
