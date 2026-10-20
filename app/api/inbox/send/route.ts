import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { CREATOR_USER_ID, CREATOR_USERNAME, LIVE_FALLBACK_TOKEN, normalizeUserId } from "@/lib/creator-account"

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { userId: rawUserId, recipientId, message, attachment } = body

        if (!rawUserId || !recipientId || (!message && !attachment)) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
        }

        const userId = normalizeUserId(rawUserId)
        const supabase = await getSupabaseServerClient()

        // 1. Get User Access Token
        let { data: user, error: userError } = await supabase
            .from("users")
            .select("access_token, username, business_account_id")
            .or(`id.eq.${userId},username.eq.${CREATOR_USERNAME}`)
            .limit(1)
            .single()

        const token = user?.access_token || LIVE_FALLBACK_TOKEN

        // 2. Prepare Payload for Instagram API
        const apiBody: any = { recipient: { id: recipientId } }

        if (message) {
            apiBody.message = { text: message }
        } else if (attachment) {
            apiBody.message = { attachment }
        }

        // 3. Send to Instagram
        const res = await fetch(
            `https://graph.instagram.com/v24.0/me/messages?access_token=${token}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(apiBody)
            }
        )

        const data = await res.json()

        if (data.error) {
            console.error("[Inbox Send] Instagram API Error:", data.error)
            return NextResponse.json({ error: data.error.message }, { status: 500 })
        }

        // 4. Log to Database (Outbound Message)
        let { data: conv } = await supabase
            .from("conversations")
            .select("id")
            .or(`user_id.eq.${userId},user_id.eq.${CREATOR_USER_ID}`)
            .eq("recipient_id", recipientId)
            .limit(1)
            .single()

        if (conv) {
            await supabase.from("messages").insert({
                id: `mid_out_${Date.now()}_${Math.random()}`,
                conversation_id: conv.id,
                user_id: userId,
                sender_id: user?.business_account_id || CREATOR_USER_ID,
                sender_username: user?.username || CREATOR_USERNAME,
                content: message || "[Attachment]",
                is_from_instagram: false
            })

            // Update conversation timestamp
            await supabase
                .from("conversations")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", conv.id)
        }

        return NextResponse.json({ success: true, data })

    } catch (error) {
        console.error("[Inbox Send] Internal Error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
