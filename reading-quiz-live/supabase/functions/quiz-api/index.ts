import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ ok: false, error: "POST required" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply({ ok: false, error: "Server is not configured" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const body = await req.json();
    const action = String(body.action || "");
    const roomCode = String(body.room_code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const playerId = String(body.player_id || "").slice(0, 80);

    if (action === "create") {
      if (roomCode.length < 4) return reply({ ok: false, error: "Room code must have 4–8 letters or numbers" }, 400);
      if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 100) return reply({ ok: false, error: "Provide 1–100 questions" }, 400);
      // NOTE: For production, protect room creation with teacher authentication and an allowlist.
      const sanitized = body.questions.map((q: any) => ({
        passage: String(q.passage || "").slice(0, 5000),
        question: String(q.question || "").slice(0, 1000),
        options: Array.isArray(q.options) ? q.options.slice(0, 4).map((x: unknown) => String(x).slice(0, 500)) : [],
        answer: Number(q.answer),
        points: Math.min(1000, Math.max(1, Number(q.points) || 100)),
        seconds: Math.min(180, Math.max(5, Number(q.seconds) || 20)),
        explanation: String(q.explanation || "").slice(0, 1000),
      }));
      if (sanitized.some((q: any) => !q.question || q.options.length !== 4 || q.options.some((x: string) => !x) || !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3)) return reply({ ok: false, error: "Invalid question data" }, 400);
      const { data, error } = await db.from("quiz_rooms").insert({ room_code: roomCode, questions: sanitized }).select("id,room_code,status,question_index").single();
      if (error) return reply({ ok: false, error: error.code === "23505" ? "Room code already exists" : "Could not create room" }, 400);
      return reply({ ok: true, room: data, players: [], questions: sanitized.map((q: any) => ({...q, answer: undefined})) });
    }

    const { data: room, error: roomError } = await db.from("quiz_rooms").select("*").eq("room_code", roomCode).maybeSingle();
    if (roomError || !room) return reply({ ok: false, error: "Room not found" }, 404);

    const getPlayers = async () => {
      const { data } = await db.from("quiz_participants").select("player_id,nickname,score,joined_at").eq("room_id", room.id).order("score", { ascending: false });
      return (data || []).map((p: any) => ({ id: p.player_id, nickname: p.nickname, score: p.score, joinedAt: new Date(p.joined_at).getTime() }));
    };
    const publicQuestions = (qs: any[], reveal = false) => qs.map((q: any) => ({
      passage: q.passage, question: q.question, options: q.options, points: q.points, seconds: q.seconds,
      ...(reveal ? { answer: q.answer, explanation: q.explanation } : {}),
    }));

    if (action === "join") {
      if (!playerId || !String(body.nickname || "").trim()) return reply({ ok: false, error: "Nickname and player ID are required" }, 400);
      if (room.status === "finished") return reply({ ok: false, error: "This quiz has already finished" }, 400);
      const { error } = await db.from("quiz_participants").upsert({ room_id: room.id, player_id: playerId, nickname: String(body.nickname).trim().slice(0, 24) }, { onConflict: "room_id,player_id" });
      if (error) return reply({ ok: false, error: "Could not join room" }, 400);
      return reply({ ok: true, players: await getPlayers(), questions: publicQuestions(room.questions), question_index: room.question_index, status: room.status, deadline: room.deadline });
    }

    if (action === "state") {
      const { data: me } = await db.from("quiz_participants").select("id").eq("room_id", room.id).eq("player_id", playerId).maybeSingle();
      if (!me) return reply({ ok: false, error: "Join this room first" }, 403);
      return reply({ ok: true, players: await getPlayers(), questions: publicQuestions(room.questions), question_index: room.question_index, status: room.status, deadline: room.deadline });
    }

    // These actions must be protected with real teacher authentication before public deployment.
    if (["start", "next", "end"].includes(action)) {
      if (action === "end") {
        const { error } = await db.from("quiz_rooms").update({ status: "finished", question_index: room.questions.length, deadline: null }).eq("id", room.id);
        if (error) return reply({ ok: false, error: "Could not finish quiz" }, 400);
      } else {
        const nextIndex = action === "start" ? 0 : room.question_index + 1;
        if (nextIndex >= room.questions.length) {
          const { error } = await db.from("quiz_rooms").update({ status: "finished", question_index: room.questions.length, deadline: null }).eq("id", room.id);
          if (error) return reply({ ok: false, error: "Could not finish quiz" }, 400);
        } else {
          const duration = Number(room.questions[nextIndex].seconds || 20);
          const { error } = await db.from("quiz_rooms").update({ status: "live", question_index: nextIndex, deadline: new Date(Date.now() + duration * 1000).toISOString() }).eq("id", room.id);
          if (error) return reply({ ok: false, error: "Could not advance quiz" }, 400);
        }
      }
      const { data: updated } = await db.from("quiz_rooms").select("*").eq("id", room.id).single();
      return reply({ ok: true, players: await getPlayers(), questions: publicQuestions(updated.questions), question_index: updated.question_index, status: updated.status, deadline: updated.deadline });
    }

    if (action === "answer") {
      if (room.status !== "live" || room.question_index !== Number(body.question_index)) return reply({ ok: false, error: "This question is no longer active" }, 400);
      if (room.deadline && new Date(room.deadline).getTime() < Date.now()) return reply({ ok: false, error: "Time is up" }, 400);
      const answerIndex = Number(body.answer_index);
      if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) return reply({ ok: false, error: "Invalid answer" }, 400);
      const { data: participant } = await db.from("quiz_participants").select("id,score").eq("room_id", room.id).eq("player_id", playerId).maybeSingle();
      if (!participant) return reply({ ok: false, error: "Participant not found" }, 403);
      const q = room.questions[room.question_index];
      const correct = answerIndex === q.answer;
      const remaining = room.deadline ? Math.max(0, Math.ceil((new Date(room.deadline).getTime() - Date.now()) / 1000)) : 0;
      const awarded = correct ? Number(q.points || 100) + Math.floor(remaining * 2) : 0;
      const { error: answerError } = await db.from("quiz_answers").insert({ room_id: room.id, participant_id: participant.id, question_index: room.question_index, answer_index: answerIndex, is_correct: correct, points_awarded: awarded });
      if (answerError) return reply({ ok: false, error: answerError.code === "23505" ? "You have already answered this question" : "Could not save answer" }, 400);
      await db.from("quiz_participants").update({ score: Number(participant.score || 0) + awarded }).eq("id", participant.id);
      return reply({ ok: true, correct, awarded, explanation: q.explanation, players: await getPlayers() });
    }
    return reply({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return reply({ ok: false, error: "Unexpected server error" }, 500);
  }
});