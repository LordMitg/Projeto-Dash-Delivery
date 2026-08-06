/**
 * Limites de tentativa nas rotas sensiveis.
 *
 * `express-rate-limit` ja estava no package.json, mas nunca foi aplicado em
 * nenhuma rota: login e recuperacao aceitavam tentativas ilimitadas, o que
 * torna forca bruta viavel — especialmente na recuperacao, onde as respostas
 * vem de um conjunto pequeno e previsivel ("sao paulo", "rex", ...).
 */
import rateLimit from 'express-rate-limit'

/**
 * Login e cadastro. O limite conta por IP e ignora requisicoes bem-sucedidas,
 * para nao punir quem esta usando o sistema normalmente — so tentativa falha
 * consome cota.
 */
export const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  },
})

/**
 * Recuperacao de senha: teto mais baixo que o login.
 *
 * Complementa (nao substitui) a trava por conta em `users.recoveryAttempts`:
 * este limite barra o atacante distribuindo tentativas entre varias contas,
 * enquanto a trava por conta barra o ataque focado em uma vitima.
 */
export const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Muitas tentativas de recuperação. Aguarde alguns minutos.',
  },
})
