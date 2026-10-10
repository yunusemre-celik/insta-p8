import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const supabase = await getSupabaseServerClient()

    // 1. First attempt: match by direct user_id
    const { data: directRules, error: directError } = await supabase
      .from("automations")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (!directError && directRules && directRules.length > 0) {
      return NextResponse.json(directRules)
    }

    // 2. Second attempt: Check if user has a business_account_id / page_id that matches
    const { data: userRecord } = await supabase
      .from("users")
      .select("id, business_account_id, page_id")
      .eq("id", userId)
      .single()

    const candidateIds = [userId]
    if (userRecord?.business_account_id) candidateIds.push(userRecord.business_account_id)
    if (userRecord?.page_id) candidateIds.push(userRecord.page_id)

    const { data: candidateRules } = await supabase
      .from("automations")
      .select("*")
      .in("user_id", candidateIds)
      .order("created_at", { ascending: false })

    if (candidateRules && candidateRules.length > 0) {
      return NextResponse.json(candidateRules)
    }

    // 3. Fallback: If no rules found under candidateIds, return all automations in DB and link them to this user
    const { data: allRules } = await supabase
      .from("automations")
      .select("*")
      .order("created_at", { ascending: false })

    if (allRules && allRules.length > 0) {
      // Auto-relink to current user so subsequent queries are immediate
      await supabase.from("automations").update({ user_id: userId }).is("user_id", null)
      return NextResponse.json(allRules)
    }

    return NextResponse.json([])
  } catch (error) {
    console.error("[v0] Automations GET error:", error)
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, name, trigger_source, trigger_type, trigger_value, content, specific_media_id } = await request.json()

    if (!userId || !name || !trigger_value || !content || !trigger_source) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    // Validate trigger_source
    if (!['comment', 'dm', 'story'].includes(trigger_source)) {
      return NextResponse.json({ error: "Invalid trigger source" }, { status: 400 })
    }

    const supabase = await getSupabaseServerClient()

    // STABLE FIX: Always save to the Login ID
    const finalTriggerValue =
      trigger_type === "postback"
        ? `PAYLOAD_${Date.now()}_${Math.random().toString(36).substring(7)}`
        : trigger_value.toLowerCase()

    const { data, error } = await supabase
      .from("automations")
      .insert({
        user_id: userId,
        name,
        trigger_source,
        trigger_type: trigger_type || "keyword",
        trigger_value: finalTriggerValue,
        response_type: "pro",
        response_content: content,
        is_active: true,
        specific_media_id: specific_media_id || null,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Automations POST error:", error)
    return NextResponse.json({ error: "Failed to create" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const supabase = await getSupabaseServerClient()
    const { error } = await supabase.from("automations").delete().eq("id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Automations DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, name, trigger_source, trigger_type, trigger_value, content, specific_media_id } = await request.json()

    if (!id || !name || !trigger_value || !content) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    // Validate trigger_source if provided
    if (trigger_source && !['comment', 'dm', 'story'].includes(trigger_source)) {
      return NextResponse.json({ error: "Invalid trigger source" }, { status: 400 })
    }

    const supabase = await getSupabaseServerClient()

    const updateData: any = {
      name,
      trigger_type: trigger_type || "keyword",
      trigger_value: trigger_value.toLowerCase(),
      response_content: content,
      specific_media_id: specific_media_id || null,
    }

    // Only update trigger_source if provided
    if (trigger_source) {
      updateData.trigger_source = trigger_source
    }

    const { data, error } = await supabase
      .from("automations")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Automations PUT error:", error)
    return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id, is_active, action } = await request.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const supabase = await getSupabaseServerClient()

    if (action === "duplicate") {
      const { data: original, error: fetchError } = await supabase
        .from("automations")
        .select("*")
        .eq("id", id)
        .single()
      if (fetchError || !original) return NextResponse.json({ error: "Not found" }, { status: 404 })

      const { id: _id, created_at, updated_at, ...rest } = original
      const { data, error } = await supabase
        .from("automations")
        .insert({ ...rest, name: `${original.name} (copy)`, is_active: false })
        .select()
        .single()
      if (error) throw error
      return NextResponse.json(data)
    }

    if (typeof is_active !== "boolean") {
      return NextResponse.json({ error: "Missing is_active" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("automations")
      .update({ is_active })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Automations PATCH error:", error)
    return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  }
}
