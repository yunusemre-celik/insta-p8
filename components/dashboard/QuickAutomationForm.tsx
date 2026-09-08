"use client"

import { useEffect, useRef, useState } from "react"
import { Bookmark, Check, Copy, Loader2, Plus, Trash2, X } from "lucide-react"
import type { Automation } from "@/lib/types"

type Source = Automation["trigger_source"]

export interface AutomationTemplate {
  id: string
  name: string
  source: Source
  answer: string
}

const DEFAULT_TEMPLATES: AutomationTemplate[] = [
  {
    id: "default-comment-link",
    name: "Yorum -> DM Link Gönderimi",
    source: "comment",
    answer: "Harika! İstediğin bağlantıyı ve tüm detayları DM olarak buradan iletiyorum: https://",
  },
  {
    id: "default-dm-info",
    name: "DM -> Hızlı Bilgi & Fiyat",
    source: "dm",
    answer: "Merhaba! İlgilendiğin paket ve fiyat detayları hakkında bilgi vermek isterim. Detaylar: ...",
  },
  {
    id: "default-story-gift",
    name: "Story -> Teşekkür & Hediye",
    source: "story",
    answer: "Hikayeme yanıt verdiğin için çok teşekkürler! İşte senin için hazırladığım bağlantı: https://",
  },
]

const STORAGE_KEY = "insta_automation_templates_v1"

export function QuickAutomationForm({ userId, initialSource, onSuccess, presetData }: {
  userId: string
  initialSource: Source
  onSuccess: (source: Source) => void
  presetData?: { source: Source; answer: string; keyword?: string } | null
}) {
  const [source, setSource] = useState<Source>(initialSource)
  const [keyword, setKeyword] = useState("")
  const [answer, setAnswer] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const submitting = useRef(false)
  const keywordInputRef = useRef<HTMLInputElement>(null)

  // Templates state
  const [templates, setTemplates] = useState<AutomationTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [templateNameInput, setTemplateNameInput] = useState("")
  const [templateSavedFeedback, setTemplateSavedFeedback] = useState(false)

  // Load templates from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTemplates(parsed)
          return
        }
      }
      setTemplates(DEFAULT_TEMPLATES)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_TEMPLATES))
    } catch {
      setTemplates(DEFAULT_TEMPLATES)
    }
  }, [])

  // When presetData is supplied (e.g. from cloning an existing automation)
  useEffect(() => {
    if (!presetData) return
    if (presetData.source) setSource(presetData.source)
    if (presetData.answer) setAnswer(presetData.answer)
    if (presetData.keyword) setKeyword(presetData.keyword)
    setSelectedTemplateId("")
    keywordInputRef.current?.focus()
  }, [presetData])

  function handleSelectTemplate(templateId: string) {
    setSelectedTemplateId(templateId)
    if (!templateId) return
    const selected = templates.find(t => t.id === templateId)
    if (selected) {
      setSource(selected.source)
      setAnswer(selected.answer)
      keywordInputRef.current?.focus()
    }
  }

  function handleSaveNewTemplate() {
    if (!answer.trim()) {
      setError("Şablon olarak kaydetmek için lütfen önce bir yanıt mesajı yazın.")
      return
    }
    const name = templateNameInput.trim() || `Şablon (${keyword.trim() || (source === "comment" ? "Yorum" : source === "dm" ? "DM" : "Story")})`
    const newTemplate: AutomationTemplate = {
      id: "tpl_" + Date.now().toString(),
      name,
      source,
      answer: answer.trim(),
    }
    const updated = [newTemplate, ...templates]
    setTemplates(updated)
    setSelectedTemplateId(newTemplate.id)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    } catch {}
    setIsSavingTemplate(false)
    setTemplateNameInput("")
    setTemplateSavedFeedback(true)
    setTimeout(() => setTemplateSavedFeedback(false), 3000)
  }

  function handleDeleteTemplate(templateId: string) {
    if (!confirm("Bu şablonu silmek istediğinize emin misiniz?")) return
    const updated = templates.filter(t => t.id !== templateId)
    setTemplates(updated)
    setSelectedTemplateId("")
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    } catch {}
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !keyword.trim() || !answer.trim()) return
    submitting.current = true
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          name: `Reply to ${keyword.trim()}`,
          trigger_source: source,
          trigger_type: source === "story" ? "reply" : "keyword",
          trigger_value: keyword.trim(),
          content: { message: answer.trim(), ...(source === "comment" ? { reply_mode: "dm_only" } : {}) },
          specific_media_id: null,
        }),
      })
      if (!response.ok) throw new Error("Could not save. Please try again.")
      setKeyword("")
      // Keep answer so user can quickly add another keyword if they wish, or clear it
      onSuccess(source)
    } catch {
      setError("Could not save. Check your connection and try again.")
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return <form onSubmit={save} className="overflow-hidden rounded-xl border border-border bg-card">
    <fieldset disabled={saving} className="min-w-0">
      {/* Top Header: Source Selector & Template Quick Picker */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">Reply to</span>
            <select
              value={source}
              onChange={event => setSource(event.target.value as Source)}
              className="rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="dm">Direct messages</option>
              <option value="comment">Post comments</option>
              <option value="story">Story replies</option>
            </select>
          </label>

          <span className="hidden text-border sm:inline">|</span>

          {/* Template Selector */}
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">Şablon:</span>
            <select
              value={selectedTemplateId}
              onChange={e => handleSelectTemplate(e.target.value)}
              className="max-w-[200px] truncate rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[250px]"
            >
              <option value="">-- Şablon Seç --</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            {selectedTemplateId && (
              <button
                type="button"
                onClick={() => handleDeleteTemplate(selectedTemplateId)}
                title="Seçili şablonu sil"
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Save as Template action */}
        <div className="flex items-center gap-2">
          {templateSavedFeedback && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Check className="size-3.5" /> Şablon kaydedildi!
            </span>
          )}
          {!isSavingTemplate ? (
            <button
              type="button"
              onClick={() => setIsSavingTemplate(true)}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Mevcut mesaj ve ayarları şablon olarak kaydet"
            >
              <Bookmark className="size-3.5" />
              <span>Şablon Olarak Kaydet</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                autoFocus
                placeholder="Şablon adı girin..."
                value={templateNameInput}
                onChange={e => setTemplateNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleSaveNewTemplate()
                  }
                  if (e.key === "Escape") setIsSavingTemplate(false)
                }}
                className="w-36 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-44"
              />
              <button
                type="button"
                onClick={handleSaveNewTemplate}
                className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
              >
                Kaydet
              </button>
              <button
                type="button"
                onClick={() => setIsSavingTemplate(false)}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Form Fields */}
      <div className="grid sm:grid-cols-[1fr_2fr]">
        <label className="block border-b border-border p-4 sm:border-b-0 sm:border-r">
          <span className="text-xs font-medium text-muted-foreground">When they say</span>
          <input
            ref={keywordInputRef}
            required
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="e.g. link, fiyat, rehber"
            className="mt-2 w-full rounded-sm bg-card py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="block p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Send this reply</span>
            {selectedTemplateId && (
              <span className="text-[11px] text-muted-foreground">
                (Şablon yüklendi)
              </span>
            )}
          </div>
          <textarea
            required
            maxLength={1000}
            rows={3}
            value={answer}
            onChange={event => setAnswer(event.target.value)}
            placeholder="Our plans start at ₹499. Here’s the link…"
            className="mt-2 w-full resize-y rounded-sm bg-card py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {source === "comment"
            ? "Any post or reel · Reply sent by DM"
            : source === "story"
            ? "Matches keywords in story replies"
            : "Matches keywords in incoming DMs"}
        </p>
        <button
          disabled={saving || !keyword.trim() || !answer.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? "Saving…" : "Save reply"}
        </button>
      </div>
      {error && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{error}</p>}
    </fieldset>
  </form>
}

