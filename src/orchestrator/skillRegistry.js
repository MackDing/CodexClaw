export class SkillRegistry {
  constructor(skills = {}, { onChange } = {}) {
    this.skillNames = Object.keys(skills).sort();
    this.chatStates = new Map();
    this.onChange = onChange;
  }

  normalizeSkillName(name) {
    return String(name || "").trim().toLowerCase();
  }

  ensureKnownSkill(name) {
    const normalized = this.normalizeSkillName(name);
    if (!this.skillNames.includes(normalized)) {
      throw new Error(`Unknown skill: ${name}`);
    }
    return normalized;
  }

  ensureChatState(chatId) {
    const key = String(chatId);
    const existing = this.chatStates.get(key);
    if (existing) return existing;

    const state = {
      enabledSkills: new Set(this.skillNames)
    };

    this.chatStates.set(key, state);
    return state;
  }

  list(chatId) {
    const state = this.ensureChatState(chatId);
    return this.skillNames.map((name) => ({
      name,
      enabled: state.enabledSkills.has(name)
    }));
  }

  isEnabled(chatId, name) {
    const normalized = this.ensureKnownSkill(name);
    const state = this.ensureChatState(chatId);
    return state.enabledSkills.has(normalized);
  }

  enable(chatId, name) {
    const normalized = this.ensureKnownSkill(name);
    const state = this.ensureChatState(chatId);
    const changed = !state.enabledSkills.has(normalized);
    state.enabledSkills.add(normalized);
    if (changed) {
      this.onChange?.(this.exportState());
    }
    return {
      changed,
      skills: this.list(chatId)
    };
  }

  disable(chatId, name) {
    const normalized = this.ensureKnownSkill(name);
    const state = this.ensureChatState(chatId);
    const changed = state.enabledSkills.has(normalized);
    state.enabledSkills.delete(normalized);
    if (changed) {
      this.onChange?.(this.exportState());
    }
    return {
      changed,
      skills: this.list(chatId)
    };
  }

  exportState() {
    const chats = {};
    for (const [chatId, state] of this.chatStates.entries()) {
      chats[chatId] = {
        enabledSkills: [...state.enabledSkills].sort()
      };
    }

    return {
      chats
    };
  }

  restoreState(snapshot = {}) {
    const chats = snapshot?.chats;
    if (!chats || typeof chats !== "object") return;

    this.chatStates.clear();

    for (const [chatId, state] of Object.entries(chats)) {
      const enabledSkills = Array.isArray(state?.enabledSkills)
        ? state.enabledSkills
            .map((skill) => this.normalizeSkillName(skill))
            .filter((skill) => this.skillNames.includes(skill))
        : this.skillNames;

      this.chatStates.set(String(chatId), {
        enabledSkills: new Set(enabledSkills)
      });
    }
  }
}
