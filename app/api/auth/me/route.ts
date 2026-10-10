import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
  try {
    const rawSession = request.cookies.get("insta_session")?.value
    if (rawSession) {
      try {
        const session = JSON.parse(rawSession)
        if (session.userId) {
          const supabase = await getSupabaseServerClient()
          const { data: user } = await supabase
            .from("users")
            .select("id, username, profile_picture_url, business_account_id")
            .eq("id", session.userId)
            .single()

          if (user) {
            return NextResponse.json({
              userId: user.id,
              username: user.username,
              profilePic: user.profile_picture_url || null,
              businessAccountId: user.business_account_id || null,
            })
          }
        }
      } catch (e) {
        // invalid cookie parse, fall through
      }
    }

    // Fallback: If no cookie or user not found by cookie, pick the latest active user from DB
    const supabase = await getSupabaseServerClient()
    const { data: latestUser } = await supabase
      .from("users")
      .select("id, username, profile_picture_url, business_account_id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single()

    if (latestUser) {
      const response = NextResponse.json({
        userId: latestUser.id,
        username: latestUser.username,
        profilePic: latestUser.profile_picture_url || null,
        businessAccountId: latestUser.business_account_id || null,
      })
      response.cookies.set(
        "insta_session",
        JSON.stringify({ username: latestUser.username, userId: latestUser.id }),
        { path: "/", maxAge: 60 * 24 * 60 * 60, sameSite: "lax", secure: process.env.NODE_ENV === "production" }
      )
      return response
    }

    return NextResponse.json({ userId: null, username: null, profilePic: null })
  } catch (error: any) {
    console.error("[auth/me] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
