# Dimensioni delle immagini e uso delle risorse

Misurato nella fase 6 (Alpine, build multi-stage, API in un unico bundle con tsdown):

| Immagine      | Dimensione | Prima  |
| ------------- | ---------- | ------ |
| `api`         | 241 MB     | 339 MB |
| `web`         | 31,9 MB    | 104 MB |
| `cloudflared` | 73 MB      |        |

| Caso                                            | Memoria                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A riposo                                        | api circa 43 MiB, web circa 8 MiB                                                                   |
| File da 1 GB: upload, cifratura, download e zip | picco RSS di Node nell'api circa 156 MB, picco del container circa 482 MB (fase zip), limite 768 MB |

La memoria non dipende dalla dimensione del file, perché upload, cifratura, download e zip sono tutti in streaming. Per misurarla tu su uno stack locale: `node scripts/measure-transfer.mjs --size-gb 5`.
