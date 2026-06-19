// MINIMAL HAND-WRITTEN STUB — replace with generated types once the Supabase
// project exists and migration 0001 is applied:
//   npm run db:types
// (regenerates this file from the live schema). Until then this stub lets the
// Supabase client wrappers + any user_profiles read typecheck. Keep in sync with
// migration 0001_init_core.sql if you edit the schema before regenerating.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          first_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          first_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
