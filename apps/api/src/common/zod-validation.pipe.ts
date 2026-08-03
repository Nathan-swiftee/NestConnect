import { PipeTransform, BadRequestException } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates a request payload against a Zod schema and returns the parsed
 * (and defaulted) value. Usage: `@Body(new ZodValidationPipe(schema))`.
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
