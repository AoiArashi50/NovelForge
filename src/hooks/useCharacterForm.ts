import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

export const characterSchema = z.object({
  name: z.string().min(1, "角色名不能为空"),
  aliases: z.string(),
  age: z.string(),
  personality: z.string(),
  motivations: z.string(),
  speech: z.string(),
  taboos: z.string(),
  arc: z.string(),
})

export type CharacterFormData = z.infer<typeof characterSchema>

export const DEFAULT_CHARACTER_VALUES: CharacterFormData = {
  name: "",
  aliases: "",
  age: "",
  personality: "",
  motivations: "",
  speech: "",
  taboos: "",
  arc: "",
}

export function useCharacterForm(defaultValues?: Partial<CharacterFormData>) {
  return useForm<CharacterFormData>({
    resolver: zodResolver(characterSchema),
    defaultValues: { ...DEFAULT_CHARACTER_VALUES, ...defaultValues },
  })
}

export function formDataToCharacterPayload(data: CharacterFormData) {
  return {
    name: data.name,
    aliases: data.aliases.split(",").map(s => s.trim()).filter(Boolean),
    age: data.age || undefined,
    personalityTraits: data.personality.split(",").map(s => s.trim()).filter(Boolean),
    coreMotivations: data.motivations || undefined,
    speechPatterns: data.speech || undefined,
    taboos: data.taboos.split(",").map(s => s.trim()).filter(Boolean),
    canonicalArcSummary: data.arc || undefined,
  }
}
