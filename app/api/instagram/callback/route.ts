import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import {
  CREATOR_USER_ID,
  CREATOR_BIZ_ID,
  CREATOR_USERNAME,
  normalizeUserId,
} from "@/lib/creator-account"
import { POST as handleMetaWebhookDelivery } from "../webhook/route"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  // Meta webhook verification handshake support (hub.* query params)
  // in case the Meta App Dashboard webhook callback is pointed at this URL.
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode === "subscribe" && challenge) {
    const expectedToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "insta_guvenli_token_2026"
    if (token === expectedToken) {
      console.log("[callback] Responded to Meta webhook verification handshake")
      return new NextResponse(challenge, { status: 200 })
    }
    return new NextResponse("Forbidden", { status: 403 })
  }

  const code = searchParams.get("code")
  const error = searchParams.get("error")

  if (error) {
    const redirectUrl = new URL("/", request.url)
    redirectUrl.searchParams.set("error", error)
    return NextResponse.redirect(redirectUrl)
  }

  if (code) {
    const redirectUrl = new URL("/", request.url)
    redirectUrl.searchParams.set("code", code)
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.json({ error: "Invalid callback" }, { status: 400 })
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get("x-hub-signature-256")

    // If this is a Meta webhook event delivery delivered to /api/instagram/callback
    if (signature || (rawBody.includes('"object":"instagram"') && rawBody.includes('"entry"'))) {
      console.log("[callback] Meta webhook delivery detected - delegating to webhook processor")
      return handleMetaWebhookDelivery(
        new NextRequest(request.url, {
          method: "POST",
          headers: request.headers,
          body: rawBody,
        })
      )
    }

    let body: any = {}
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const { code } = body
    if (!code) return NextResponse.json({ error: "No code" }, { status: 400 })

    // 1. Env Vars
    const clientId = process.env.INSTAGRAM_APP_ID
    const clientSecret = process.env.INSTAGRAM_APP_SECRET
    const redirectUri = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Missing Env Vars: Check INSTAGRAM_APP_ID")
    }

    // 2. Exchange Code for Short Token
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    })

    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    })

    const rawTokenText = await tokenRes.text()
    let tokenData: any = {}
    try {
      tokenData = JSON.parse(rawTokenText)
    } catch {
      tokenData = {}
    }

    if (!tokenRes.ok) {
      if (tokenData.error_message?.includes("authorization code has been used")) {
        // Harmless double-fire from React StrictMode or double clicks
        return NextResponse.json({ error: "Code already used" }, { status: 400 })
      }
      console.error("[v0] 🔴 Token Error:", rawTokenText)
      return NextResponse.json({ error: tokenData.error_description || "Token failed" }, { status: 400 })
    }

    const shortToken = tokenData.access_token
    const idMatch = rawTokenText.match(/"user_id"\s*:\s*"?(\d+)"?/)
    const loginUserId = idMatch ? idMatch[1] : (tokenData.user_id ? tokenData.user_id.toString() : CREATOR_USER_ID)

    // 3. Exchange for Long Token (60 Days)
    const longLivedUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortToken}`
    const longRes = await fetch(longLivedUrl)
    const longData = await longRes.json()
    const accessToken = longData.access_token || shortToken
    const expiresIn = longData.expires_in || 5184000

    // 4. Get Username + IG Professional Account ID
    let username = CREATOR_USERNAME
    let businessAccountId = CREATOR_BIZ_ID
    let profilePic: string | null = null
    let targetUserId = CREATOR_USER_ID

    try {
      const meRes = await fetch(
        `https://graph.instagram.com/v24.0/me?fields=user_id,username,profile_picture_url&access_token=${accessToken}`
      )
      const meData = await meRes.json()
      console.log("[v0] 📋 /me response:", JSON.stringify(meData))

      if (meData.username) username = meData.username
      if (meData.profile_picture_url) profilePic = meData.profile_picture_url
      if (meData.user_id) {
        businessAccountId = meData.user_id.toString()
        console.log(`[v0] 🎯 Got IG Professional Account ID (user_id): ${businessAccountId}`)
      }
      if (meData.id) {
        targetUserId = meData.id.toString()
      } else {
        targetUserId = normalizeUserId(loginUserId)
      }
    } catch (e) {
      console.error("[v0] /me request failed:", e)
      targetUserId = normalizeUserId(loginUserId)
    }

    // 5. Save/Update User in Database with proper ID resolution
    const supabase = await getSupabaseServerClient()

    const { data: existingUser } = await supabase
      .from("users")
      .select("id, username")
      .or(`username.eq.${username},id.eq.${targetUserId}`)
      .limit(1)
      .single()

    const saveId = existingUser ? normalizeUserId(existingUser.id) : targetUserId

    const updates: any = {
      username,
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      business_account_id: businessAccountId,
      page_id: businessAccountId,
    }

    console.log(`[v0] 💾 Saving user: ${username} | id=${saveId} | biz_id=${businessAccountId}`)

    const { error: upsertError } = await supabase
      .from("users")
      .upsert({ id: saveId, ...updates }, { onConflict: "id" })

    if (upsertError) {
      console.warn("[v0] Primary key upsert warning, updating by username:", upsertError.message)
      await supabase
        .from("users")
        .update(updates)
        .eq("username", username)
    }

    const response = NextResponse.json({ success: true, username, userId: saveId, profilePic })
    response.cookies.set("insta_session", JSON.stringify({ username, userId: saveId }), {
      path: "/",
      maxAge: expiresIn,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
    return response

  } catch (error: any) {
    console.error("[callback] login failed:", error)
    return NextResponse.json({ error: error?.message || "Login failed" }, { status: 500 })
  }
}
