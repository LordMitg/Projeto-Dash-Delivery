import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requirePermission } from '../middleware/auth.js';

const router = Router();

/**
 * Envio de imagem de produto.
 *
 * O arquivo vai para o DISCO local (`backend/uploads/<tenantId>/`) e o banco
 * guarda so o caminho publico em `Product.imageUrl`. As alternativas foram
 * descartadas por motivos concretos:
 *
 * - base64 no Postgres: cada foto inflaria a linha do produto em ~1/3 do peso do
 *   arquivo, e `GET /api/products` — que o PDV chama a cada abertura — passaria a
 *   arrastar todas as fotos do catalogo em JSON.
 * - servico externo de blob: exigiria conta e credencial para um backend que hoje
 *   roda inteiro na maquina da loja.
 *
 * Consequencia assumida: as fotos vivem no disco do servidor, entao o diretorio
 * `uploads/` entra no backup junto com o banco. Se algum dia este backend for
 * para um ambiente sem disco persistente (serverless), este e o ponto que
 * precisa migrar para um blob de verdade.
 */

/** Onde os arquivos ficam. `process.cwd()` e a pasta `backend/` em dev e build. */
const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

/**
 * Tipos aceitos, casados com a extensao que gravamos.
 *
 * A checagem e por LISTA, nao por "tudo que comeca com image/": `image/svg+xml`
 * tambem e imagem e aceita <script> dentro, o que viraria XSS servido do proprio
 * dominio. SVG nao entra.
 */
const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB: foto de celular passa, PDF disfarçado não

/**
 * `memoryStorage` porque o arquivo e pequeno e so vai para o disco DEPOIS de
 * passar pela validacao. Com `diskStorage`, o multer gravaria antes de sabermos
 * se o tipo e aceito, deixando lixo na pasta a cada tentativa invalida.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    cb(new Error('Formato não aceito. Envie JPG, PNG ou WEBP.'));
  },
});

/**
 * POST /api/uploads/product-image
 *
 * Recebe `multipart/form-data` com o campo `file` e devolve `{ url }` para o
 * cliente gravar em `imageUrl`. Exige `products:manage`: quem nao pode alterar o
 * catalogo nao pode subir arquivo para o servidor.
 */
router.post(
  '/product-image',
  requirePermission('products:manage'),
  (req: Request, res: Response) => {
    upload.single('file')(req, res, async (err: unknown) => {
      // O multer sinaliza limite de tamanho com um codigo proprio; traduzimos
      // para uma frase que diz o que fazer, em vez de "LIMIT_FILE_SIZE".
      if (err) {
        const isTooBig =
          typeof err === 'object' && err !== null && (err as { code?: string }).code === 'LIMIT_FILE_SIZE';
        const msg = isTooBig
          ? 'Imagem muito grande. O limite é 4 MB.'
          : err instanceof Error
            ? err.message
            : 'Falha ao receber o arquivo.';
        return res.status(400).json({ success: false, error: msg });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
      }

      try {
        const tenantId = req.auth!.tenantId;

        /**
         * Nome SORTEADO, nunca o nome enviado pelo cliente.
         *
         * `file.originalname` e texto sob controle de quem chama: algo como
         * `../../index.js` escaparia da pasta de uploads e sobrescreveria codigo
         * do servidor. Sorteando o nome, o dado do cliente nunca toca o caminho.
         * A extensao vem da nossa lista, nao do arquivo.
         */
        const name = `${randomBytes(16).toString('hex')}${ALLOWED[file.mimetype]}`;

        // Uma pasta por tenant: mantem o dado de cada loja separado no disco.
        const dir = path.join(UPLOAD_ROOT, tenantId);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, name), file.buffer);

        return res.status(201).json({
          success: true,
          data: { url: `/uploads/${tenantId}/${name}` },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro ao gravar a imagem.';
        return res.status(500).json({ success: false, error: msg });
      }
    });
  },
);

export { router as uploadRoutes, UPLOAD_ROOT };
