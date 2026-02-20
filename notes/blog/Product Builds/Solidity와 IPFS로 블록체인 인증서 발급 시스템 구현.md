---
tags:
  - Blockchain
  - Solidity
  - IPFS
  - Web3
  - Ethereum
  - wagmi
title: Solidity와 IPFS로 블록체인 인증서 발급 시스템 구현
created: 2024-11-10
modified: 2024-11-18
---

# 배경

교육 수료증이나 자격증 같은 인증서는 위변조가 쉽다는 문제가 있다. PDF나 이미지로 발급하면 누구든 수정할 수 있고, 검증하려면 발급 기관에 일일이 확인해야 한다. 블록체인에 발급 이력을 기록하고 메타데이터를 IPFS에 저장하면 이 문제를 해결할 수 있다. 인증서 데이터가 변경 불가능한 상태로 보존되고, 누구나 온체인에서 유효성을 검증할 수 있다.

프로젝트는 pnpm 모노레포로 구성했다. `packages/contracts`에 Hardhat + Solidity 스마트 컨트랙트, `packages/frontend`에 Next.js 14 + wagmi 프론트엔드를 두었다.

# 스마트 컨트랙트

## 역할 기반 접근 제어

인증서 발급은 아무나 할 수 없다. Admin이 Issuer를 지정하고, Issuer만 인증서를 발급할 수 있다.

```solidity
contract CertificateContract {
    struct Certificate {
        uint256 id;
        address issuer;
        string recipientName;
        string metadataURI;
        uint256 issuedAt;
        bool isValid;
        string certificateType;
    }

    address public admin;
    mapping(address => bool) public issuers;
    mapping(uint256 => Certificate) public certificates;
    mapping(address => uint256[]) public userCertificates;
    uint256 private _certificateCounter;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyIssuer() {
        require(issuers[msg.sender], "Only issuer");
        _;
    }

    event CertificateIssued(uint256 indexed id, address indexed issuer, string recipientName);
    event CertificateRevoked(uint256 indexed id);

    function addIssuer(address issuer) external onlyAdmin {
        issuers[issuer] = true;
    }

    function issueCertificate(
        string memory recipientName,
        string memory metadataURI,
        string memory certificateType
    ) external onlyIssuer returns (uint256) {
        _certificateCounter++;
        certificates[_certificateCounter] = Certificate({
            id: _certificateCounter,
            issuer: msg.sender,
            recipientName: recipientName,
            metadataURI: metadataURI,
            issuedAt: block.timestamp,
            isValid: true,
            certificateType: certificateType
        });
        userCertificates[msg.sender].push(_certificateCounter);
        emit CertificateIssued(_certificateCounter, msg.sender, recipientName);
        return _certificateCounter;
    }

    function revokeCertificate(uint256 id) external {
        require(
            certificates[id].issuer == msg.sender || msg.sender == admin,
            "Not authorized"
        );
        certificates[id].isValid = false;
        emit CertificateRevoked(id);
    }

    function validateCertificate(uint256 id) external view returns (bool) {
        return certificates[id].isValid;
    }
}
```

`onlyAdmin`과 `onlyIssuer` modifier로 접근을 제한한다. 인증서 취소는 발급자 본인이나 Admin만 가능하다. OpenZeppelin의 패턴을 참고했지만, 프로젝트 규모에 맞게 단순화했다.

## 배포

Hardhat으로 로컬 노드와 Sepolia 테스트넷 모두 배포할 수 있게 설정했다.

```javascript
const CertificateContract = await hre.ethers.getContractFactory("CertificateContract");
const certificate = await CertificateContract.deploy();
await certificate.deployed();
```

개발 시에는 `concurrently`와 `wait-on`으로 Hardhat 노드 → 컨트랙트 배포 → 프론트엔드 순서를 자동화했다.

# IPFS 업로드

인증서 이미지와 메타데이터를 Pinata SDK로 IPFS에 업로드한다. API 라우트에서 서버사이드로 처리해 JWT가 클라이언트에 노출되지 않도록 했다.

```ts
export async function POST(request: NextRequest) {
  const data = await request.formData();
  const file = data.get('file') as File;
  const uploadData = await pinata.upload.file(file);
  return NextResponse.json(uploadData.IpfsHash, { status: 200 });
}
```

클라이언트에서는 이 API를 호출하는 헬퍼를 사용한다.

```ts
export async function uploadToIPFS(file: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/files', { method: 'POST', body: formData });
  return await response.json();
}
```

# 인증서 발급 플로우

발급 과정은 다음 순서로 진행된다.

1. 사용자가 폼에 수료자 이름, 인증서 타입, 내용 등을 입력한다.
2. `html2canvas`로 미리보기 DOM 요소를 PNG 이미지로 캡처한다.
3. 이미지를 IPFS에 업로드하고 해시를 받는다.
4. 이미지 해시를 포함한 메타데이터 JSON을 다시 IPFS에 업로드한다.
5. 메타데이터 URI로 스마트 컨트랙트의 `issueCertificate`를 호출한다.
6. 트랜잭션 영수증을 기다린 뒤 결과를 표시한다.

```ts
async function uploadCertificateData(formData: FormData, previewElement: HTMLElement) {
  const canvas = await html2canvas(previewElement);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png')
  );

  const imageHash = await uploadToIPFS(blob);
  const metadata = {
    name: formData.recipientName,
    description: `${formData.certificateType} Certificate`,
    image: `https://${GATEWAY_URL}/ipfs/${imageHash}`,
    attributes: { issueDate: new Date().toISOString(), type: formData.certificateType },
  };

  const metadataBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
  const metadataHash = await uploadToIPFS(metadataBlob);
  return `https://${GATEWAY_URL}/ipfs/${metadataHash}`;
}

async function issueCertificate(formData: FormData, previewElement: HTMLElement) {
  if (!address || !isIssuer) throw new Error('권한 없음');

  const metadataUri = await uploadCertificateData(formData, previewElement);
  writeContract({
    address: CONTRACT_ADDRESS,
    abi: certificateABI,
    functionName: 'issueCertificate',
    args: [formData.recipientName, metadataUri, formData.certificateType],
  }, {
    onSuccess: async (hash) => {
      await waitForTransactionReceipt(publicClient, { hash });
    },
  });
}
```

wagmi의 `useWriteContract`로 트랜잭션을 보내고, `waitForTransactionReceipt`로 완료를 확인한다.

# wagmi 설정

```ts
import { createConfig, http, WagmiProvider } from 'wagmi';
import { hardhat, mainnet, sepolia } from 'wagmi/chains';

const config = createConfig({
  chains: [mainnet, sepolia, hardhat],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [hardhat.id]: http('http://127.0.0.1:8545'),
  },
});
```

로컬 개발, Sepolia 테스트넷, 메인넷 체인을 모두 설정해두고 환경에 따라 전환한다.

# 결과

블록체인에 기록된 인증서는 발급자, 수료자 이름, 메타데이터 URI, 발급 시점이 모두 온체인에 남아 위변조가 불가능하다. IPFS에 저장된 이미지와 메타데이터도 content-addressed 특성상 변경되면 해시가 달라지므로 무결성이 보장된다. `validateCertificate` 함수로 누구나 유효성을 검증할 수 있다.

# Reference

- https://hardhat.org/
- https://docs.openzeppelin.com/contracts
- https://wagmi.sh/
- https://docs.pinata.cloud/
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob

# 연결문서

- [[pnpm 워크스페이스 모노레포 구성]]
- [[Canvas + jsPDF로 인증 문서 자동 생성]]
- [[NestJS GraphQL에서 역할 기반 접근 제어 구현하기]]
