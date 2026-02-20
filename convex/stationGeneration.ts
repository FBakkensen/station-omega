import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Public mutation to kick off station generation.
 * Creates a progress tracker and schedules the generation action.
 * Returns the progress ID so the client can subscribe to updates.
 */
export const start = mutation({
  args: {
    difficulty: v.union(v.literal("normal"), v.literal("hard"), v.literal("nightmare")),
    characterClass: v.union(
      v.literal("engineer"),
      v.literal("scientist"),
      v.literal("medic"),
      v.literal("commander"),
    ),
  },
  returns: v.id("generationProgress"),
  handler: async (ctx, args) => {
    // Create progress tracker (explicit type annotation to avoid circular inference)
    const progressId: Id<"generationProgress"> = await ctx.runMutation(
      internal.generationProgress.create,
      { config: { difficulty: args.difficulty, characterClass: args.characterClass } },
    );

    // Schedule the generation action
    await ctx.scheduler.runAfter(0, internal.actions.generateStation.generate, {
      progressId,
      difficulty: args.difficulty,
      characterClass: args.characterClass,
    });

    return progressId;
  },
});
