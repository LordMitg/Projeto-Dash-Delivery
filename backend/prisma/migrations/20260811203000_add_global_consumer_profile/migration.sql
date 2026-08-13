CREATE TABLE "consumer_profiles" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "consumer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "consumer_profiles_phone_key" ON "consumer_profiles"("phone");
