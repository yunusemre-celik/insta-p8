import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { CREATOR_USER_ID, CREATOR_USERNAME, LIVE_FALLBACK_TOKEN, normalizeUserId } from "@/lib/creator-account"

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const rawUserId = searchParams.get("userId")

        if (!rawUserId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
        const userId = normalizeUserId(rawUserId)

        const supabase = await getSupabaseServerClient()
        const { data, error } = await supabase
            .from("ice_breakers")
            .select("*")
            .or(`user_id.eq.${userId},user_id.eq.${CREATOR_USER_ID}`)
            .order("created_at", { ascending: true })

        if (error) throw error

        return NextResponse.json(data || [])
    } catch (error) {
        console.error("Ice Breaker GET Error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { userId: rawUserId, iceBreakers } = body

        if (!rawUserId || !Array.isArray(iceBreakers)) {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
        }

        const userId = normalizeUserId(rawUserId)
        const supabase = await getSupabaseServerClient()

        // 1. Update Database
        const { error: deleteError } = await supabase
            .from("ice_breakers")
            .delete()
            .or(`user_id.eq.${userId},user_id.eq.${CREATOR_USER_ID}`)

        if (deleteError) throw deleteError

        const { data: inserted, error: insertError } = await supabase
            .from("ice_breakers")
            .insert(iceBreakers.map((ib: any) => ({
                user_id: userId,
                question: ib.question,
                response: ib.response,
                is_active: true
            })))
            .select()

        if (insertError) throw insertError

        // 2. Sync to Instagram
        let { data: user } = await supabase
            .from("users")
            .select("access_token, page_id")
            .or(`id.eq.${userId},username.eq.${CREATOR_USERNAME}`)
            .limit(1)
            .single()

        let accessToken = user?.access_token || LIVE_FALLBACK_TOKEN

        if (accessToken) {
            const ice_breakers = (inserted || []).map((ib: any) => ({
                question: ib.question,
                payload: `ICE_BREAKER_${ib.id}`
            }))

            if (ice_breakers.length > 0) {
                try {
                    await fetch(`https://graph.instagram.com/v24.0/me/messenger_profile?access_token=${accessToken}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            platform: "instagram",
                            ice_breakers: ice_breakers.slice(0, 4)
                        })
                    })
                } catch (e) {
                    console.error("Failed to sync ice breakers to Meta:", e)
                }
            }
        }

        return NextResponse.json({ success: true, count: inserted?.length || 0 })
    } catch (error) {
        console.error("Ice Breaker POST Error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
