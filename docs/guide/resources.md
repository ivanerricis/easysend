# Image sizes and resource usage

Measured in phase 6 (Alpine, multi-stage builds, API bundled with tsdown):

| Image         | Size    | Before |
| ------------- | ------- | ------ |
| `api`         | 241 MB  | 339 MB |
| `web`         | 31.9 MB | 104 MB |
| `cloudflared` | 73 MB   |        |

| Case                                         | Memory                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| At rest                                      | api about 43 MiB, web about 8 MiB                                                            |
| 1 GB file: upload, encrypt, download and zip | api Node RSS peak about 156 MB, container memory peak about 482 MB (zip phase), limit 768 MB |

Memory does not depend on the file size, because upload, encryption, download and zip are all streamed. To measure it yourself against a local stack: `node scripts/measure-transfer.mjs --size-gb 5`.
