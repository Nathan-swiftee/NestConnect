import { Global, Module } from "@nestjs/common";
import { SecretEncryptionService } from "./secret-encryption.service";

// Global so the stores (and anything else) can inject the encryption service
// without threading it through every module.
@Global()
@Module({
  providers: [SecretEncryptionService],
  exports: [SecretEncryptionService],
})
export class CryptoModule {}
