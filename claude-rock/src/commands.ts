import type { SlashCommand } from "./types";
import type { LanguageCode } from "./systemPrompts";

// Localized content for commands
interface CommandLocale {
	name: string;
	description: string;
	prompt: string;
}

type CommandLocales = Record<LanguageCode, CommandLocale>;

// Localization for each built-in command
const COMMAND_LOCALES: Record<string, CommandLocales> = {
	summarize: {
		en: {
			name: "Summarize",
			description: "Brief summary of the note",
			prompt: "Make a brief summary of this note. Focus on key points and main ideas."
		},
		ru: {
			name: "Резюме",
			description: "Краткое резюме заметки",
			prompt: "Сделай краткое резюме этой заметки. Сфокусируйся на ключевых моментах и главных идеях."
		},
		fr: {
			name: "Résumer",
			description: "Résumé bref de la note",
			prompt: "Fais un bref résumé de cette note. Concentre-toi sur les points clés et les idées principales."
		},
		de: {
			name: "Zusammenfassen",
			description: "Kurze Zusammenfassung der Notiz",
			prompt: "Erstelle eine kurze Zusammenfassung dieser Notiz. Konzentriere dich auf die wichtigsten Punkte und Hauptideen."
		},
		es: {
			name: "Resumir",
			description: "Resumen breve de la nota",
			prompt: "Haz un breve resumen de esta nota. Enfócate en los puntos clave y las ideas principales."
		},
		hi: {
			name: "सारांश",
			description: "नोट का संक्षिप्त सारांश",
			prompt: "इस नोट का संक्षिप्त सारांश बनाओ। मुख्य बिंदुओं और मुख्य विचारों पर ध्यान दो।"
		},
		zh: {
			name: "总结",
			description: "笔记简要总结",
			prompt: "对这篇笔记做一个简要总结。重点关注要点和主要观点。"
		},
		ja: {
			name: "要約",
			description: "ノートの簡潔な要約",
			prompt: "このノートの簡潔な要約を作成してください。重要なポイントと主なアイデアに焦点を当ててください。"
		}
	},
	translate: {
		en: {
			name: "Translate",
			description: "Translate to specified language",
			prompt: "Translate this text to {arg}. Preserve the original formatting and structure."
		},
		ru: {
			name: "Перевод",
			description: "Перевести на указанный язык",
			prompt: "Переведи этот текст на {arg}. Сохрани оригинальное форматирование и структуру."
		},
		fr: {
			name: "Traduire",
			description: "Traduire vers la langue spécifiée",
			prompt: "Traduis ce texte en {arg}. Préserve le formatage et la structure originaux."
		},
		de: {
			name: "Übersetzen",
			description: "In die angegebene Sprache übersetzen",
			prompt: "Übersetze diesen Text auf {arg}. Behalte die ursprüngliche Formatierung und Struktur bei."
		},
		es: {
			name: "Traducir",
			description: "Traducir al idioma especificado",
			prompt: "Traduce este texto a {arg}. Preserva el formato y la estructura originales."
		},
		hi: {
			name: "अनुवाद",
			description: "निर्दिष्ट भाषा में अनुवाद करें",
			prompt: "इस टेक्स्ट को {arg} में अनुवाद करो। मूल फॉर्मेटिंग और संरचना को बनाए रखो।"
		},
		zh: {
			name: "翻译",
			description: "翻译成指定语言",
			prompt: "将此文本翻译成{arg}。保留原始格式和结构。"
		},
		ja: {
			name: "翻訳",
			description: "指定された言語に翻訳",
			prompt: "このテキストを{arg}に翻訳してください。元のフォーマットと構造を保持してください。"
		}
	},
	rewrite: {
		en: {
			name: "Rewrite",
			description: "Rewrite for clarity",
			prompt: "Rewrite this text to make it clearer and more readable. Improve structure and flow while preserving the meaning."
		},
		ru: {
			name: "Переписать",
			description: "Переписать понятнее",
			prompt: "Перепиши этот текст, чтобы он стал понятнее и читабельнее. Улучши структуру и плавность, сохраняя смысл."
		},
		fr: {
			name: "Réécrire",
			description: "Réécrire pour plus de clarté",
			prompt: "Réécris ce texte pour le rendre plus clair et lisible. Améliore la structure et le flux tout en préservant le sens."
		},
		de: {
			name: "Umschreiben",
			description: "Für Klarheit umschreiben",
			prompt: "Schreibe diesen Text um, um ihn klarer und lesbarer zu machen. Verbessere Struktur und Fluss, während du die Bedeutung bewahrst."
		},
		es: {
			name: "Reescribir",
			description: "Reescribir para mayor claridad",
			prompt: "Reescribe este texto para hacerlo más claro y legible. Mejora la estructura y el flujo manteniendo el significado."
		},
		hi: {
			name: "पुनर्लेखन",
			description: "स्पष्टता के लिए पुनर्लेखन",
			prompt: "इस टेक्स्ट को स्पष्ट और अधिक पठनीय बनाने के लिए फिर से लिखो। अर्थ को बनाए रखते हुए संरचना और प्रवाह में सुधार करो।"
		},
		zh: {
			name: "改写",
			description: "改写使其更清晰",
			prompt: "改写此文本使其更清晰易读。改善结构和流畅性，同时保持原意。"
		},
		ja: {
			name: "書き直し",
			description: "より明確に書き直す",
			prompt: "このテキストをより明確で読みやすく書き直してください。意味を保ちながら構造と流れを改善してください。"
		}
	},
	expand: {
		en: {
			name: "Expand",
			description: "Expand and develop ideas",
			prompt: "Expand and develop the ideas in this text. Add more details, examples, and explanations."
		},
		ru: {
			name: "Развить",
			description: "Развить и дополнить идеи",
			prompt: "Разверни и дополни идеи в этом тексте. Добавь больше деталей, примеров и объяснений."
		},
		fr: {
			name: "Développer",
			description: "Développer et approfondir les idées",
			prompt: "Développe et approfondis les idées de ce texte. Ajoute plus de détails, d'exemples et d'explications."
		},
		de: {
			name: "Erweitern",
			description: "Ideen erweitern und entwickeln",
			prompt: "Erweitere und entwickle die Ideen in diesem Text. Füge mehr Details, Beispiele und Erklärungen hinzu."
		},
		es: {
			name: "Expandir",
			description: "Expandir y desarrollar ideas",
			prompt: "Expande y desarrolla las ideas en este texto. Añade más detalles, ejemplos y explicaciones."
		},
		hi: {
			name: "विस्तार",
			description: "विचारों को विस्तृत और विकसित करें",
			prompt: "इस टेक्स्ट में विचारों को विस्तृत और विकसित करो। अधिक विवरण, उदाहरण और स्पष्टीकरण जोड़ो।"
		},
		zh: {
			name: "扩展",
			description: "扩展和发展想法",
			prompt: "扩展和发展此文本中的想法。添加更多细节、示例和解释。"
		},
		ja: {
			name: "展開",
			description: "アイデアを展開・発展させる",
			prompt: "このテキストのアイデアを展開し発展させてください。詳細、例、説明を追加してください。"
		}
	},
	fix: {
		en: {
			name: "Fix",
			description: "Fix errors and typos",
			prompt: "Fix any errors, typos, and grammatical mistakes in this text. Keep the original style and meaning."
		},
		ru: {
			name: "Исправить",
			description: "Исправить ошибки и опечатки",
			prompt: "Исправь все ошибки, опечатки и грамматические ошибки в этом тексте. Сохрани оригинальный стиль и смысл."
		},
		fr: {
			name: "Corriger",
			description: "Corriger les erreurs et fautes",
			prompt: "Corrige toutes les erreurs, fautes de frappe et erreurs grammaticales dans ce texte. Garde le style et le sens originaux."
		},
		de: {
			name: "Korrigieren",
			description: "Fehler und Tippfehler beheben",
			prompt: "Behebe alle Fehler, Tippfehler und grammatikalischen Fehler in diesem Text. Behalte den ursprünglichen Stil und die Bedeutung bei."
		},
		es: {
			name: "Corregir",
			description: "Corregir errores y erratas",
			prompt: "Corrige todos los errores, erratas y errores gramaticales en este texto. Mantén el estilo y significado originales."
		},
		hi: {
			name: "सुधारें",
			description: "त्रुटियाँ और टाइपो ठीक करें",
			prompt: "इस टेक्स्ट में सभी त्रुटियों, टाइपो और व्याकरण की गलतियों को ठीक करो। मूल शैली और अर्थ बनाए रखो।"
		},
		zh: {
			name: "修正",
			description: "修正错误和拼写",
			prompt: "修正此文本中的所有错误、拼写错误和语法错误。保持原有的风格和含义。"
		},
		ja: {
			name: "修正",
			description: "エラーと誤字を修正",
			prompt: "このテキストの誤り、誤字、文法的な間違いをすべて修正してください。元のスタイルと意味を保持してください。"
		}
	},
	bullets: {
		en: {
			name: "Bullets",
			description: "Convert to bullet points",
			prompt: "Convert this text into a bulleted list. Extract key points and organize them logically."
		},
		ru: {
			name: "Списком",
			description: "Преобразовать в маркированный список",
			prompt: "Преобразуй этот текст в маркированный список. Выдели ключевые пункты и организуй их логически."
		},
		fr: {
			name: "Puces",
			description: "Convertir en liste à puces",
			prompt: "Convertis ce texte en liste à puces. Extrais les points clés et organise-les logiquement."
		},
		de: {
			name: "Aufzählung",
			description: "In Aufzählung umwandeln",
			prompt: "Wandle diesen Text in eine Aufzählung um. Extrahiere die wichtigsten Punkte und ordne sie logisch."
		},
		es: {
			name: "Viñetas",
			description: "Convertir a viñetas",
			prompt: "Convierte este texto en una lista con viñetas. Extrae los puntos clave y organízalos lógicamente."
		},
		hi: {
			name: "बुलेट्स",
			description: "बुलेट पॉइंट में बदलें",
			prompt: "इस टेक्स्ट को बुलेटेड लिस्ट में बदलो। मुख्य बिंदु निकालो और उन्हें तार्किक रूप से व्यवस्थित करो।"
		},
		zh: {
			name: "要点",
			description: "转换为项目符号列表",
			prompt: "将此文本转换为项目符号列表。提取要点并按逻辑组织。"
		},
		ja: {
			name: "箇条書き",
			description: "箇条書きに変換",
			prompt: "このテキストを箇条書きリストに変換してください。重要なポイントを抽出し、論理的に整理してください。"
		}
	},
	questions: {
		en: {
			name: "Questions",
			description: "Generate questions about the topic",
			prompt: "Generate thoughtful questions about this text that would help deepen understanding of the topic."
		},
		ru: {
			name: "Вопросы",
			description: "Сгенерировать вопросы по теме",
			prompt: "Сгенерируй вдумчивые вопросы по этому тексту, которые помогут глубже понять тему."
		},
		fr: {
			name: "Questions",
			description: "Générer des questions sur le sujet",
			prompt: "Génère des questions réfléchies sur ce texte qui aideraient à approfondir la compréhension du sujet."
		},
		de: {
			name: "Fragen",
			description: "Fragen zum Thema generieren",
			prompt: "Erstelle durchdachte Fragen zu diesem Text, die das Verständnis des Themas vertiefen würden."
		},
		es: {
			name: "Preguntas",
			description: "Generar preguntas sobre el tema",
			prompt: "Genera preguntas reflexivas sobre este texto que ayuden a profundizar la comprensión del tema."
		},
		hi: {
			name: "प्रश्न",
			description: "विषय पर प्रश्न उत्पन्न करें",
			prompt: "इस टेक्स्ट के बारे में विचारशील प्रश्न उत्पन्न करो जो विषय की समझ को गहरा करने में मदद करें।"
		},
		zh: {
			name: "问题",
			description: "生成关于主题的问题",
			prompt: "生成关于此文本的深思熟虑的问题，以帮助加深对主题的理解。"
		},
		ja: {
			name: "質問",
			description: "トピックについて質問を生成",
			prompt: "このテキストについて、トピックの理解を深めるのに役立つ思慮深い質問を生成してください。"
		}
	},
	difficulty: {
		en: {
			name: "Difficulty",
			description: "Adjust explanation complexity",
			prompt: ""
		},
		ru: {
			name: "Сложность",
			description: "Изменить сложность объяснения",
			prompt: ""
		},
		fr: {
			name: "Difficulté",
			description: "Ajuster la complexité de l'explication",
			prompt: ""
		},
		de: {
			name: "Schwierigkeit",
			description: "Erklärungskomplexität anpassen",
			prompt: ""
		},
		es: {
			name: "Dificultad",
			description: "Ajustar complejidad de explicación",
			prompt: ""
		},
		hi: {
			name: "कठिनाई",
			description: "व्याख्या जटिलता समायोजित करें",
			prompt: ""
		},
		zh: {
			name: "难度",
			description: "调整解释复杂度",
			prompt: ""
		},
		ja: {
			name: "難易度",
			description: "説明の複雑さを調整",
			prompt: ""
		}
	}
};

// Command IDs and icons (language-independent)
const BUILTIN_COMMAND_IDS = [
	{ id: "summarize", command: "/summarize", icon: "list" },
	{ id: "translate", command: "/translate", icon: "languages" },
	{ id: "rewrite", command: "/rewrite", icon: "pencil" },
	{ id: "expand", command: "/expand", icon: "maximize-2" },
	{ id: "fix", command: "/fix", icon: "check-circle" },
	{ id: "bullets", command: "/bullets", icon: "list-minus" },
	{ id: "questions", command: "/questions", icon: "help-circle" },
	{ id: "difficulty", command: "/difficulty", icon: "graduation-cap" }
];

/**
 * Get built-in commands localized for the specified language
 */
export function getBuiltinCommands(language: LanguageCode): SlashCommand[] {
	return BUILTIN_COMMAND_IDS.map(cmd => {
		const locale = COMMAND_LOCALES[cmd.id]?.[language] ?? COMMAND_LOCALES[cmd.id]?.en;
		return {
			id: cmd.id,
			name: locale?.name ?? cmd.id,
			command: cmd.command,
			prompt: locale?.prompt ?? "",
			description: locale?.description ?? "",
			icon: cmd.icon,
			isBuiltin: true,
			enabled: true
		};
	});
}

// For settings page - use English names
export const BUILTIN_COMMANDS: SlashCommand[] = getBuiltinCommands("en");

/**
 * Parse a command string and extract the command and argument
 * e.g., "/translate Russian" -> { command: "/translate", arg: "Russian" }
 */
export function parseCommand(input: string): { command: string; arg: string } | null {
	const match = input.match(/^(\/\w+)(?:\s+(.+))?$/);
	if (!match || !match[1]) return null;
	return {
		command: match[1],
		arg: match[2]?.trim() ?? ""
	};
}

/**
 * Get all available commands (built-in + custom, excluding disabled)
 */
export function getAvailableCommands(
	customCommands: SlashCommand[],
	disabledBuiltinIds: string[],
	language: LanguageCode = "en"
): SlashCommand[] {
	const builtins = getBuiltinCommands(language).filter(
		cmd => !disabledBuiltinIds.includes(cmd.id)
	);
	const customs = customCommands.filter(cmd => cmd.enabled);
	return [...builtins, ...customs];
}

/**
 * Filter commands by partial input (for autocomplete)
 */
export function filterCommands(commands: SlashCommand[], input: string): SlashCommand[] {
	const query = input.toLowerCase();
	return commands.filter(cmd =>
		cmd.command.toLowerCase().startsWith(query) ||
		cmd.name.toLowerCase().includes(query.replace("/", ""))
	);
}

/**
 * Build the final prompt from a command and context
 */
export function buildCommandPrompt(command: SlashCommand, arg: string, context?: string): string {
	let prompt = command.prompt;

	// Replace {arg} placeholder if present
	if (arg) {
		prompt = prompt.replace("{arg}", arg);
	} else {
		// Remove {arg} placeholder if no argument provided
		prompt = prompt.replace(/\s*\{arg\}/g, "");
	}

	// If there's file context, it will be prepended by ChatView
	return prompt;
}
