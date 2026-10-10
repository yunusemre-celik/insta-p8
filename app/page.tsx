"use client"

import { useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { LandingPage } from "@/components/layout/landing-page"
import { Loader2 } from "lucide-react"

export default function Home() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Check if we have an active session or a callback code
    const code = searchParams.get("code")
    const savedId = localStorage.getItem("ig_user_id")

    if (code) {
      router.replace(`/dashboard?code=${encodeURIComponent(code)}`)
    } else if (savedId) {
      router.replace("/dashboard")
    }
  }, [searchParams, router])

  return <LandingPage />
}
