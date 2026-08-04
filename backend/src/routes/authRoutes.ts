import { Router } from 'express';
import { authController } from '../controllers/authController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

/**
 * POST /auth/login
 * Body: { email, password, tenantId }
 * Returns: { token, user }
 */
router.post('/login', authController.login);

/**
 * POST /auth/register
 * Body: { email, password, firstName, lastName, tenantId }
 * Returns: { token, user }
 */
router.post('/register', authController.register);

/**
 * POST /auth/verify
 * Headers: Authorization: Bearer <token>
 * Returns: { valid: true, user }
 */
router.post('/verify', authController.verify);

/**
 * POST /auth/refresh
 * Headers: Authorization: Bearer <token>
 * Returns: { token (new) }
 */
router.post('/refresh', authController.refresh);

/**
 * GET /auth/me (protegido)
 * Retorna dados do usuário autenticado
 */
router.get('/me', authenticate, (req, res) => {
  res.json({
    user: (req as any).user
  });
});

export default router;
