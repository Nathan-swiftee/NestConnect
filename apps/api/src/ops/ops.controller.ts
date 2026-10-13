import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  opsChecklistInputSchema,
  opsCollectionInputSchema,
  opsModuleInputSchema,
  opsSopInputSchema,
  publishOpsSopInputSchema,
  updateOpsCollectionInputSchema,
  updateOpsSopInputSchema,
  type OpsAckReport,
  type OpsCollection,
  type OpsCollectionInput,
  type OpsLibrary,
  type OpsRevision,
  type OpsSop,
  type OpsSopInput,
  type OpsStatusInfo,
  type PublishOpsSopInput,
  type UpdateOpsCollectionInput,
  type UpdateOpsSopInput,
} from "@ding/schemas";
import { CurrentUserId } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { OpsService } from "./ops.service";

/** Business Ops — the workspace's own SOPs. See docs/business-ops.md. */
@Controller("ops")
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  /** Answers with the module off too: it's how the apps know to hide it. */
  @Get("status")
  status(@CurrentUserId() userId: string): Promise<OpsStatusInfo> {
    return this.ops.status(userId);
  }

  @Put("module")
  setModule(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(opsModuleInputSchema)) body: { enabled: boolean },
  ): Promise<OpsStatusInfo> {
    return this.ops.setEnabled(userId, body.enabled);
  }

  @Get("library")
  library(@CurrentUserId() userId: string, @Query("q") q?: string): Promise<OpsLibrary> {
    return this.ops.library(userId, typeof q === "string" ? q.slice(0, 200) : undefined);
  }

  /* collections */

  @Post("collections")
  createCollection(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(opsCollectionInputSchema)) body: OpsCollectionInput,
  ): Promise<OpsCollection> {
    return this.ops.createCollection(userId, body);
  }

  @Patch("collections/:id")
  updateCollection(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateOpsCollectionInputSchema)) body: UpdateOpsCollectionInput,
  ): Promise<OpsCollection> {
    return this.ops.updateCollection(userId, id, body);
  }

  @Delete("collections/:id")
  async removeCollection(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ ok: true }> {
    await this.ops.removeCollection(userId, id);
    return { ok: true };
  }

  /* SOPs */

  @Post("sops")
  create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(opsSopInputSchema)) body: OpsSopInput,
  ): Promise<OpsSop> {
    return this.ops.create(userId, body);
  }

  @Get("sops/:id")
  get(@CurrentUserId() userId: string, @Param("id") id: string): Promise<OpsSop> {
    return this.ops.get(userId, id);
  }

  @Patch("sops/:id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateOpsSopInputSchema)) body: UpdateOpsSopInput,
  ): Promise<OpsSop> {
    return this.ops.update(userId, id, body);
  }

  @Delete("sops/:id")
  async remove(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ ok: true }> {
    await this.ops.remove(userId, id);
    return { ok: true };
  }

  @Post("sops/:id/publish")
  publish(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(publishOpsSopInputSchema)) body: PublishOpsSopInput,
  ): Promise<OpsSop> {
    return this.ops.publish(userId, id, body);
  }

  @Post("sops/:id/archive")
  archive(@CurrentUserId() userId: string, @Param("id") id: string): Promise<OpsSop> {
    return this.ops.archive(userId, id);
  }

  @Post("sops/:id/restore")
  restore(@CurrentUserId() userId: string, @Param("id") id: string): Promise<OpsSop> {
    return this.ops.restore(userId, id);
  }

  @Post("sops/:id/reviewed")
  reviewed(@CurrentUserId() userId: string, @Param("id") id: string): Promise<OpsSop> {
    return this.ops.markReviewed(userId, id);
  }

  @Get("sops/:id/versions")
  versions(@CurrentUserId() userId: string, @Param("id") id: string): Promise<OpsRevision[]> {
    return this.ops.versions(userId, id);
  }

  @Post("sops/:id/ack")
  acknowledge(@CurrentUserId() userId: string, @Param("id") id: string): Promise<OpsSop> {
    return this.ops.acknowledge(userId, id);
  }

  @Get("sops/:id/acks")
  acks(@CurrentUserId() userId: string, @Param("id") id: string): Promise<OpsAckReport> {
    return this.ops.ackReport(userId, id);
  }

  @Put("sops/:id/checklist")
  async setChecklist(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(opsChecklistInputSchema)) body: { done: number[] },
  ): Promise<{ done: number[] }> {
    return { done: await this.ops.setChecklist(userId, id, body.done) };
  }

  @Delete("sops/:id/checklist")
  async resetChecklist(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ done: number[] }> {
    return { done: await this.ops.setChecklist(userId, id, []) };
  }
}
