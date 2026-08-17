-- CreateEnum
CREATE TYPE "chat_message_kind" AS ENUM ('TEXT', 'PHOTO', 'VOICE');

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "sender_id" TEXT,
    "kind" "chat_message_kind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "file_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_messages_company_id_trip_id_created_at_idx" ON "chat_messages"("company_id", "trip_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
