
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function enqueueAiSummaryJob(args: { user_id: string; game_id: string; quarter_id: string }) {
  const { error } = await supabaseAdmin.from("jobs").insert({
    type: "ai_summary",
    status: "queued",
    user_id: args.user_id,
    game_id: args.game_id,
    quarter_id: args.quarter_id,
    payload: {},
  });
  if (error) throw new Error(error.message);
}
