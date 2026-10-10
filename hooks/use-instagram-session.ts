"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"

export function useInstagramSession() {
    const [username, setUsername] = useState<string | null>(null)
    const [userId, setUserId] = useState<string | null>(null)
    const [profilePic, setProfilePic] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const searchParams = useSearchParams()
    const router = useRouter()

    useEffect(() => {
        const code = searchParams.get("code")

        const handleSession = async () => {
            // CASE A: New Login from Instagram
            if (code) {
                try {
                    const res = await fetch("/api/instagram/callback", {
                        method: "POST",
                        body: JSON.stringify({ code }),
                    })
                    const data = await res.json()

                    if (data.success) {
                        localStorage.setItem("ig_user_id", data.userId)
                        localStorage.setItem("ig_username", data.username)
                        if (data.profilePic) localStorage.setItem("ig_profile_pic", data.profilePic)

                        setUserId(data.userId)
                        setUsername(data.username)
                        setProfilePic(data.profilePic || null)
                        router.replace("/dashboard")
                    } else {
                        // Fallback to existing localStorage if code already consumed
                        const savedId = localStorage.getItem("ig_user_id")
                        const savedName = localStorage.getItem("ig_username")
                        if (savedId && savedName) {
                            setUserId(savedId)
                            setUsername(savedName)
                            setProfilePic(localStorage.getItem("ig_profile_pic"))
                        }
                        router.replace("/dashboard")
                    }
                } catch (err) {
                    console.error("Login failed:", err)
                    router.replace("/dashboard")
                }
            }
            // CASE B: Restore Session from Server / LocalStorage
            else {
                const savedId = typeof window !== "undefined" ? localStorage.getItem("ig_user_id") : null
                const savedName = typeof window !== "undefined" ? localStorage.getItem("ig_username") : null

                if (savedId && savedName) {
                    setUserId(savedId)
                    setUsername(savedName)
                    setProfilePic(localStorage.getItem("ig_profile_pic"))
                    setIsLoading(false)
                    return
                }

                // If not in localStorage, fetch from server session
                try {
                    const meRes = await fetch("/api/auth/me")
                    const meData = await meRes.json()
                    if (meData.userId) {
                        localStorage.setItem("ig_user_id", meData.userId)
                        if (meData.username) localStorage.setItem("ig_username", meData.username)
                        if (meData.profilePic) localStorage.setItem("ig_profile_pic", meData.profilePic)

                        setUserId(meData.userId)
                        setUsername(meData.username)
                        setProfilePic(meData.profilePic || null)
                    }
                } catch (e) {
                    console.error("Failed to restore session from server:", e)
                }
            }
            setIsLoading(false)
        }

        handleSession()
    }, [searchParams, router])

    const logout = () => {
        localStorage.removeItem("ig_user_id")
        localStorage.removeItem("ig_username")
        localStorage.removeItem("ig_profile_pic")
        document.cookie = "insta_session=; Max-Age=0; path=/;"
        setUsername(null)
        setUserId(null)
        setProfilePic(null)
        router.push("/")
    }

    return { userId, username, profilePic, isLoading, logout }
}
