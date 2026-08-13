/**
 * Sobe um PostgreSQL embarcado APENAS para verificacao automatizada.
 *
 * Nao faz parte do produto: no seu PC voce usa o PostgreSQL instalado
 * normalmente, apontado por backend/.env. Este script existe para que as
 * migrations, o seed e os endpoints possam ser testados de verdade em CI ou
 * em um ambiente onde nao ha PostgreSQL instalado.
 *
 *   node scripts/test-db.mjs start
 *   node scripts/test-db.mjs stop
 */
import EmbeddedPostgres from 'embedded-postgres'
import fs from 'node:fs'
import path from 'node:path'

// A porta padrão pode estar ocupada por outro projeto local. Permitir override
// mantém o banco de teste isolado sem obrigar o desenvolvedor a encerrar o que
// já está rodando na máquina.
const PORT = Number(process.env.DELIONE_TEST_DB_PORT ?? 55432)
const DATA_DIR = path.resolve(process.env.DELIONE_TEST_DB_DIR ?? `.tmp/pgdata-${PORT}`)
const USER = 'erp'
const PASSWORD = 'erp'
const DATABASE = 'delivery_erp_test'

export const TEST_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}?schema=public`

async function start() {
  const isFresh = !fs.existsSync(DATA_DIR)
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true })

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {},
  })

  if (isFresh) {
    console.log('[test-db] inicializando cluster...')
    await pg.initialise()
  }

  console.log('[test-db] subindo postgres na porta', PORT)
  await pg.start()

  try {
    await pg.createDatabase(DATABASE)
    console.log('[test-db] banco criado:', DATABASE)
  } catch {
    console.log('[test-db] banco ja existia:', DATABASE)
  }

  fs.writeFileSync('.tmp/test-db-url', TEST_DATABASE_URL)
  console.log('[test-db] pronto')
  console.log(TEST_DATABASE_URL)
  return pg
}

async function stop() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {},
  })
  await pg.stop()
  console.log('[test-db] parado')
}

const cmd = process.argv[2]
if (cmd === 'start') {
  const pg = await start()
  // Mantem o processo vivo: o postgres embarcado morre junto com o pai.
  const shutdown = async () => {
    try {
      await pg.stop()
    } catch {}
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  setInterval(() => {}, 1 << 30)
} else if (cmd === 'stop') {
  await stop()
  process.exit(0)
} else {
  console.error('uso: node scripts/test-db.mjs start|stop')
  process.exit(1)
}
