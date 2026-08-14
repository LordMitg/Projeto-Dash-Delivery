ALTER TABLE "deliveries"
  ADD COLUMN "dispatchMode" TEXT NOT NULL DEFAULT 'own_fleet',
  ADD COLUMN "externalCourierName" TEXT;
