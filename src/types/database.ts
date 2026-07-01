export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      board_meetings: {
        Row: {
          analysis_facts: Json | null
          analysis_generated_at: string | null
          analysis_model: string | null
          analysis_prompt_version: string | null
          analysis_state: string | null
          analysis_text: Json | null
          area_contributions: Json
          closing_value_cents: number
          created_at: string
          id: string
          note: string | null
          settled_at: string | null
          user_id: string
          week_delta_cents: number
          week_index: number
        }
        Insert: {
          analysis_facts?: Json | null
          analysis_generated_at?: string | null
          analysis_model?: string | null
          analysis_prompt_version?: string | null
          analysis_state?: string | null
          analysis_text?: Json | null
          area_contributions?: Json
          closing_value_cents: number
          created_at?: string
          id?: string
          note?: string | null
          settled_at?: string | null
          user_id: string
          week_delta_cents: number
          week_index: number
        }
        Update: {
          analysis_facts?: Json | null
          analysis_generated_at?: string | null
          analysis_model?: string | null
          analysis_prompt_version?: string | null
          analysis_state?: string | null
          analysis_text?: Json | null
          area_contributions?: Json
          closing_value_cents?: number
          created_at?: string
          id?: string
          note?: string | null
          settled_at?: string | null
          user_id?: string
          week_delta_cents?: number
          week_index?: number
        }
        Relationships: []
      }
      board_resolutions: {
        Row: {
          checked: boolean
          created_at: string
          for_week_index: number
          id: string
          meeting_id: string
          text: string
          user_id: string
        }
        Insert: {
          checked?: boolean
          created_at?: string
          for_week_index: number
          id?: string
          meeting_id: string
          text: string
          user_id: string
        }
        Update: {
          checked?: boolean
          created_at?: string
          for_week_index?: number
          id?: string
          meeting_id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_resolutions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "board_meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_tools: {
        Row: {
          eis_decide: string | null
          eis_delegate: string | null
          eis_delete: string | null
          eis_do: string | null
          meditation: string | null
          protocol: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          eis_decide?: string | null
          eis_delegate?: string | null
          eis_delete?: string | null
          eis_do?: string | null
          meditation?: string | null
          protocol?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          eis_decide?: string | null
          eis_delegate?: string | null
          eis_delete?: string | null
          eis_do?: string | null
          meditation?: string | null
          protocol?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      graduated_habits: {
        Row: {
          area: string | null
          created_at: string
          graduated_on: string
          id: string
          metadata: Json
          source_habit_id: string | null
          summary: string | null
          title: string
          user_id: string
        }
        Insert: {
          area?: string | null
          created_at?: string
          graduated_on?: string
          id?: string
          metadata?: Json
          source_habit_id?: string | null
          summary?: string | null
          title: string
          user_id: string
        }
        Update: {
          area?: string | null
          created_at?: string
          graduated_on?: string
          id?: string
          metadata?: Json
          source_habit_id?: string | null
          summary?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "graduated_habits_source_habit_id_fkey"
            columns: ["source_habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_logs: {
        Row: {
          habit_id: string
          local_date: string
          log_id: string
          metadata: Json
          note: string | null
          occurred_at: string
          occurred_tz: string | null
          recorded_at: string
          source_session_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          habit_id: string
          local_date: string
          log_id?: string
          metadata?: Json
          note?: string | null
          occurred_at?: string
          occurred_tz?: string | null
          recorded_at?: string
          source_session_id?: string | null
          status: string
          user_id: string
        }
        Update: {
          habit_id?: string
          local_date?: string
          log_id?: string
          metadata?: Json
          note?: string | null
          occurred_at?: string
          occurred_tz?: string | null
          recorded_at?: string
          source_session_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          area: string | null
          cadence: string | null
          clean_since: string | null
          created_at: string
          current_streak_days: number
          description: string | null
          id: string
          kind: string
          recurrence_rule: Json | null
          status: string
          term_days: number | null
          term_started_on: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          area?: string | null
          cadence?: string | null
          clean_since?: string | null
          created_at?: string
          current_streak_days?: number
          description?: string | null
          id?: string
          kind: string
          recurrence_rule?: Json | null
          status?: string
          term_days?: number | null
          term_started_on?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: string | null
          cadence?: string | null
          clean_since?: string | null
          created_at?: string
          current_streak_days?: number
          description?: string | null
          id?: string
          kind?: string
          recurrence_rule?: Json | null
          status?: string
          term_days?: number | null
          term_started_on?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      identity_affirmations: {
        Row: {
          affirmation: string
          created_at: string
          id: string
          position: number
          updated_at: string
          user_id: string
          visualization: string
        }
        Insert: {
          affirmation: string
          created_at?: string
          id?: string
          position: number
          updated_at?: string
          user_id: string
          visualization: string
        }
        Update: {
          affirmation?: string
          created_at?: string
          id?: string
          position?: number
          updated_at?: string
          user_id?: string
          visualization?: string
        }
        Relationships: []
      }
      identity_modes: {
        Row: {
          created_at: string
          description: string
          id: string
          mode_key: string
          mode_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          mode_key: string
          mode_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          mode_key?: string
          mode_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      identity_profile: {
        Row: {
          mission: string | null
          mission_habit_id: string | null
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          mission?: string | null
          mission_habit_id?: string | null
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          mission?: string | null
          mission_habit_id?: string | null
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_profile_mission_habit_id_fkey"
            columns: ["mission_habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_values: {
        Row: {
          created_at: string
          id: string
          meaning: string
          position: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meaning: string
          position: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meaning?: string
          position?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      position_daily_snapshots: {
        Row: {
          contrib_cents: number
          habit_id: string
          local_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contrib_cents?: number
          habit_id: string
          local_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contrib_cents?: number
          habit_id?: string
          local_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_daily_snapshots_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      price_ledger: {
        Row: {
          amount_cents: number
          basis_cents: number | null
          created_at: string
          event_type: string
          ledger_id: number
          metadata: Json
          occurred_at: string
          pct: number | null
          scoring_version: number
          settlement_key: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          basis_cents?: number | null
          created_at?: string
          event_type: string
          ledger_id?: never
          metadata?: Json
          occurred_at: string
          pct?: number | null
          scoring_version: number
          settlement_key: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          basis_cents?: number | null
          created_at?: string
          event_type?: string
          ledger_id?: never
          metadata?: Json
          occurred_at?: string
          pct?: number | null
          scoring_version?: number
          settlement_key?: string
          user_id?: string
        }
        Relationships: []
      }
      settled_weeks: {
        Row: {
          days_in_week: number
          id: string
          positions: Json
          settled_at: string
          user_id: string
          week_end: string
          week_index: number
          week_start: string
        }
        Insert: {
          days_in_week: number
          id?: string
          positions?: Json
          settled_at?: string
          user_id: string
          week_end: string
          week_index: number
          week_start: string
        }
        Update: {
          days_in_week?: number
          id?: string
          positions?: Json
          settled_at?: string
          user_id?: string
          week_end?: string
          week_index?: number
          week_start?: string
        }
        Relationships: []
      }
      sprint_closes: {
        Row: {
          area: string | null
          closed_local_date: string
          frozen_basis_cents: number
          goal_achieved: boolean
          id: string
          metadata: Json
          realized_amount_cents: number
          realized_pct: number
          recorded_at: string
          sprint_id: string
          tasks_done: number
          tasks_total: number
          user_id: string
        }
        Insert: {
          area?: string | null
          closed_local_date: string
          frozen_basis_cents: number
          goal_achieved: boolean
          id?: string
          metadata?: Json
          realized_amount_cents: number
          realized_pct: number
          recorded_at?: string
          sprint_id: string
          tasks_done: number
          tasks_total: number
          user_id: string
        }
        Update: {
          area?: string | null
          closed_local_date?: string
          frozen_basis_cents?: number
          goal_achieved?: boolean
          id?: string
          metadata?: Json
          realized_amount_cents?: number
          realized_pct?: number
          recorded_at?: string
          sprint_id?: string
          tasks_done?: number
          tasks_total?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprint_closes_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      sprint_tasks: {
        Row: {
          created_at: string
          done: boolean
          done_at: string | null
          due_day: number | null
          id: string
          position: number
          sprint_id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          done_at?: string | null
          due_day?: number | null
          id?: string
          position?: number
          sprint_id: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          done?: boolean
          done_at?: string | null
          due_day?: number | null
          id?: string
          position?: number
          sprint_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprint_tasks_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      sprints: {
        Row: {
          area: string
          closed_at: string | null
          created_at: string
          goal_achieved: boolean | null
          id: string
          opened_at: string | null
          queue_position: number | null
          realized_amount_cents: number | null
          realized_band: string | null
          realized_pct: number | null
          scoring_version: number | null
          set_time_balance_cents: number | null
          size: string
          status: string
          term_days: number
          thesis: string
          updated_at: string
          user_id: string
        }
        Insert: {
          area: string
          closed_at?: string | null
          created_at?: string
          goal_achieved?: boolean | null
          id?: string
          opened_at?: string | null
          queue_position?: number | null
          realized_amount_cents?: number | null
          realized_band?: string | null
          realized_pct?: number | null
          scoring_version?: number | null
          set_time_balance_cents?: number | null
          size: string
          status?: string
          term_days: number
          thesis: string
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: string
          closed_at?: string | null
          created_at?: string
          goal_achieved?: boolean | null
          id?: string
          opened_at?: string | null
          queue_position?: number | null
          realized_amount_cents?: number | null
          realized_band?: string | null
          realized_pct?: number | null
          scoring_version?: number | null
          set_time_balance_cents?: number | null
          size?: string
          status?: string
          term_days?: number
          thesis?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          first_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          first_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          first_name?: string | null
          id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          timezone: string
          updated_at: string
          user_id: string
          week_start: number
        }
        Insert: {
          created_at?: string
          timezone?: string
          updated_at?: string
          user_id: string
          week_start?: number
        }
        Update: {
          created_at?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          week_start?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      replay_user_projection: {
        Args: {
          p_board_rows: Json
          p_ledger_rows: Json
          p_settled_weeks: Json
          p_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
