import { Router } from 'express';

const router = Router();

router.get('/status', (req, res) => {
  res.json({ success: true, message: 'API de autenticacao ativa' });
});

export default router;
