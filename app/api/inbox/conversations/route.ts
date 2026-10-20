import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getUserCandidateIds, normalizeUserId } from "@/lib/creator-account"

export async function GET(request: NextRequest) {
    try {
        const rawUserId = request.nextUrl.searchParams.get("userId")
        if (!rawUserId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

        const userId = normalizeUserId(rawUserId)
        const candidateIds = getUserCandidateIds(userId)
        const supabase = await getSupabaseServerClient()

        // Fetch conversations sorted by last message
        const { data: conversations, error } = await supabase
            .from("conversations")
            .select("*")
            .in("user_id", candidateIds)
            .order("last_message_at", { ascending: false })

        if (error) throw error

        return NextResponse.json(conversations || [])
    } catch (error) {
        console.error("[Inbox] Conversations GET error:", error)
        return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 })
    }
}
