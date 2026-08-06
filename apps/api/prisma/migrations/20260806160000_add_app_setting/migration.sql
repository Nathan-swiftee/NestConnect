-- CreateTable
CREATE TABLE "AppSetting" (
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("orgId","key")
);
