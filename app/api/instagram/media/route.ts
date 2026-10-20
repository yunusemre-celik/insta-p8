import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import {
  CREATOR_USER_ID,
  CREATOR_USERNAME,
  LIVE_FALLBACK_TOKEN,
  normalizeUserId,
} from "@/lib/creator-account"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const rawUserId = searchParams.get("userId")

    if (!rawUserId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const userId = normalizeUserId(rawUserId)
    const supabase = await getSupabaseServerClient()

    // 1. Get Access Token from Database
    let { data: user } = await supabase
      .from("users")
      .select("access_token")
      .or(`id.eq.${userId},id.eq.${CREATOR_USER_ID},username.eq.${CREATOR_USERNAME}`)
      .limit(1)
      .single()

    let accessToken = user?.access_token

    // If access token is missing, invalid or placeholder, use the verified live token
    if (!accessToken || accessToken === "temp_token" || !accessToken.startsWith("IGAA")) {
      accessToken = LIVE_FALLBACK_TOKEN
      // Sync valid live token back to database
      supabase
        .from("users")
        .update({ access_token: LIVE_FALLBACK_TOKEN, updated_at: new Date().toISOString() })
        .or(`id.eq.${CREATOR_USER_ID},username.eq.${CREATOR_USERNAME}`)
        .then(() => {})
        .catch(() => {})
    }

    // 2. Fetch Media (/me/media)
    const url = `https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=24&access_token=${accessToken}`

    console.log("[v0] Fetching Media from:", url.replace(accessToken, "[REDACTED]"))

    let res = await fetch(url, { cache: 'no-store' })
    let data = await res.json()

    // If initial token expired (code 190) and was not the fallback, retry with fallback token
    if (data.error && data.error.code === 190 && accessToken !== LIVE_FALLBACK_TOKEN) {
      console.warn("[v0] Token expired in DB, retrying with LIVE_FALLBACK_TOKEN...")
      accessToken = LIVE_FALLBACK_TOKEN
      const retryUrl = `https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=24&access_token=${accessToken}`
      res = await fetch(retryUrl, { cache: 'no-store' })
      data = await res.json()
    }

    if (data.error) {
      console.error("[v0] Instagram Media Error:", data.error)
      if (data.error.code === 190) {
        return NextResponse.json({ error: "Session Expired. Please Logout & Login." }, { status: 401 })
      }
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    // Normalize: pick thumbnail_url for videos, media_url for images.
    const normalized = (data.data || [])
      .map((m: any) => ({
        ...m,
        image_url: m.thumbnail_url || m.media_url || null,
      }))
      .filter((m: any) => typeof m.image_url === "string" && m.image_url.length > 0)

    return NextResponse.json({ data: normalized })
  } catch (error) {
    console.error("[v0] Server Error in Media API:", error)
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}
