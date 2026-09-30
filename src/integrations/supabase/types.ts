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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      access_grants: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          tier: Database["public"]["Enums"]["access_tier"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          tier: Database["public"]["Enums"]["access_tier"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          tier?: Database["public"]["Enums"]["access_tier"]
          user_id?: string
        }
        Relationships: []
      }
      access_requests: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          tier: Database["public"]["Enums"]["access_tier"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tier: Database["public"]["Enums"]["access_tier"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tier?: Database["public"]["Enums"]["access_tier"]
          user_id?: string
        }
        Relationships: []
      }
      ad_slot_analytics: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          slot_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          slot_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_slot_analytics_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "festival_ad_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_models: {
        Row: {
          cost_input_per_1k: number
          cost_output_per_1k: number
          created_at: string
          deprecated_at: string | null
          id: string
          label: string
          replacement_model_id: string | null
          retired_at: string | null
          status: string
          tier: string
        }
        Insert: {
          cost_input_per_1k?: number
          cost_output_per_1k?: number
          created_at?: string
          deprecated_at?: string | null
          id: string
          label: string
          replacement_model_id?: string | null
          retired_at?: string | null
          status?: string
          tier?: string
        }
        Update: {
          cost_input_per_1k?: number
          cost_output_per_1k?: number
          created_at?: string
          deprecated_at?: string | null
          id?: string
          label?: string
          replacement_model_id?: string | null
          retired_at?: string | null
          status?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_models_replacement_model_id_fkey"
            columns: ["replacement_model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_log: {
        Row: {
          completion_tokens: number | null
          correlation_id: string | null
          created_at: string
          duration_ms: number | null
          entry_id: string | null
          error_message: string | null
          estimated_cost_cents: number | null
          execution_id: string | null
          function_name: string
          id: string
          model_id: string
          prompt_tokens: number | null
          routing_reason: string | null
          sensitivity: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          entry_id?: string | null
          error_message?: string | null
          estimated_cost_cents?: number | null
          execution_id?: string | null
          function_name: string
          id?: string
          model_id: string
          prompt_tokens?: number | null
          routing_reason?: string | null
          sensitivity?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          entry_id?: string | null
          error_message?: string | null
          estimated_cost_cents?: number | null
          execution_id?: string | null
          function_name?: string
          id?: string
          model_id?: string
          prompt_tokens?: number | null
          routing_reason?: string | null
          sensitivity?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "ai_usage_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      artifact_metrics: {
        Row: {
          artifact_id: string
          created_at: string
          id: string
          method: string
          metric_confidence: number | null
          metric_label: string | null
          metric_name: string
          metric_value: number
          source_context: string | null
        }
        Insert: {
          artifact_id: string
          created_at?: string
          id?: string
          method?: string
          metric_confidence?: number | null
          metric_label?: string | null
          metric_name: string
          metric_value: number
          source_context?: string | null
        }
        Update: {
          artifact_id?: string
          created_at?: string
          id?: string
          method?: string
          metric_confidence?: number | null
          metric_label?: string | null
          metric_name?: string
          metric_value?: number
          source_context?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artifact_metrics_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          artifact_data: Json
          artifact_hash: string
          artifact_type: string
          artifact_version: number
          created_at: string
          entry_id: string
          governance_log_hash: string | null
          id: string
          status: string
          text_hash: string | null
          version_graph_hash: string | null
        }
        Insert: {
          artifact_data?: Json
          artifact_hash: string
          artifact_type: string
          artifact_version?: number
          created_at?: string
          entry_id: string
          governance_log_hash?: string | null
          id?: string
          status?: string
          text_hash?: string | null
          version_graph_hash?: string | null
        }
        Update: {
          artifact_data?: Json
          artifact_hash?: string
          artifact_type?: string
          artifact_version?: number
          created_at?: string
          entry_id?: string
          governance_log_hash?: string | null
          id?: string
          status?: string
          text_hash?: string | null
          version_graph_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "artifacts_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      auth_audit_log: {
        Row: {
          created_at: string
          decision: string
          details: Json | null
          event_type: string
          id: string
          ip_address: string | null
          reason: string | null
          resource: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          decision: string
          details?: Json | null
          event_type: string
          id?: string
          ip_address?: string | null
          reason?: string | null
          resource?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          decision?: string
          details?: Json | null
          event_type?: string
          id?: string
          ip_address?: string | null
          reason?: string | null
          resource?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      author_emulation_flags: {
        Row: {
          admin_notes: string | null
          admin_reviewed: boolean
          correlation_id: string | null
          created_at: string
          disclosure_id: string | null
          entry_id: string | null
          function_name: string
          id: string
          match_kind: string
          matched_author: string
          user_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          admin_reviewed?: boolean
          correlation_id?: string | null
          created_at?: string
          disclosure_id?: string | null
          entry_id?: string | null
          function_name: string
          id?: string
          match_kind: string
          matched_author: string
          user_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          admin_reviewed?: boolean
          correlation_id?: string | null
          created_at?: string
          disclosure_id?: string | null
          entry_id?: string | null
          function_name?: string
          id?: string
          match_kind?: string
          matched_author?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "author_emulation_flags_disclosure_id_fkey"
            columns: ["disclosure_id"]
            isOneToOne: false
            referencedRelation: "fine_tune_disclosures"
            referencedColumns: ["id"]
          },
        ]
      }
      authorship_certificates: {
        Row: {
          certificate_number: string
          id: string
          issued_at: string
          payload: Json
          revoked_at: string | null
          sha256_hash: string
          status: string
          submission_id: string
          user_id: string
        }
        Insert: {
          certificate_number: string
          id?: string
          issued_at?: string
          payload: Json
          revoked_at?: string | null
          sha256_hash: string
          status: string
          submission_id: string
          user_id: string
        }
        Update: {
          certificate_number?: string
          id?: string
          issued_at?: string
          payload?: Json
          revoked_at?: string | null
          sha256_hash?: string
          status?: string
          submission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "authorship_certificates_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "authorship_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      authorship_scores: {
        Row: {
          ai_influence_trace: string | null
          authorship_integrity_score: number | null
          character_pressure_quotient: number | null
          created_at: string
          cultural_texture_quotient: number | null
          dialogue_quotient: number | null
          emotional_temperature_quotient: number | null
          genre_convention_quotient: number | null
          human_revision_score: number | null
          id: string
          market_substitution_risk: number | null
          originality_score: number | null
          protected_style_cluster: string | null
          protected_style_similarity: number | null
          provenance_quotient: number | null
          provenance_score: number | null
          rhythm_quotient: number | null
          risk_band: string | null
          scene_architecture_quotient: number | null
          signals: Json | null
          submission_id: string
          syntax_quotient: number | null
          theme_quotient: number | null
          user_id: string
          voice_distinctiveness_score: number | null
        }
        Insert: {
          ai_influence_trace?: string | null
          authorship_integrity_score?: number | null
          character_pressure_quotient?: number | null
          created_at?: string
          cultural_texture_quotient?: number | null
          dialogue_quotient?: number | null
          emotional_temperature_quotient?: number | null
          genre_convention_quotient?: number | null
          human_revision_score?: number | null
          id?: string
          market_substitution_risk?: number | null
          originality_score?: number | null
          protected_style_cluster?: string | null
          protected_style_similarity?: number | null
          provenance_quotient?: number | null
          provenance_score?: number | null
          rhythm_quotient?: number | null
          risk_band?: string | null
          scene_architecture_quotient?: number | null
          signals?: Json | null
          submission_id: string
          syntax_quotient?: number | null
          theme_quotient?: number | null
          user_id: string
          voice_distinctiveness_score?: number | null
        }
        Update: {
          ai_influence_trace?: string | null
          authorship_integrity_score?: number | null
          character_pressure_quotient?: number | null
          created_at?: string
          cultural_texture_quotient?: number | null
          dialogue_quotient?: number | null
          emotional_temperature_quotient?: number | null
          genre_convention_quotient?: number | null
          human_revision_score?: number | null
          id?: string
          market_substitution_risk?: number | null
          originality_score?: number | null
          protected_style_cluster?: string | null
          protected_style_similarity?: number | null
          provenance_quotient?: number | null
          provenance_score?: number | null
          rhythm_quotient?: number | null
          risk_band?: string | null
          scene_architecture_quotient?: number | null
          signals?: Json | null
          submission_id?: string
          syntax_quotient?: number | null
          theme_quotient?: number | null
          user_id?: string
          voice_distinctiveness_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "authorship_scores_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "authorship_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      authorship_submissions: {
        Row: {
          ai_usage_type: string | null
          ai_used: boolean | null
          analysis_type: string
          character_count: number | null
          competition_id: string | null
          created_at: string
          declared_influences: string[] | null
          draft_date: string | null
          draft_number: string | null
          entry_id: string | null
          human_revision_level: number | null
          id: string
          intended_market: string | null
          project_title: string
          protected_voice_concern: boolean | null
          protected_voice_notes: string | null
          rights_status: string | null
          scene_count: number | null
          source: string
          status: string
          text_length: number | null
          updated_at: string
          user_id: string
          writer_name: string | null
        }
        Insert: {
          ai_usage_type?: string | null
          ai_used?: boolean | null
          analysis_type?: string
          character_count?: number | null
          competition_id?: string | null
          created_at?: string
          declared_influences?: string[] | null
          draft_date?: string | null
          draft_number?: string | null
          entry_id?: string | null
          human_revision_level?: number | null
          id?: string
          intended_market?: string | null
          project_title: string
          protected_voice_concern?: boolean | null
          protected_voice_notes?: string | null
          rights_status?: string | null
          scene_count?: number | null
          source?: string
          status?: string
          text_length?: number | null
          updated_at?: string
          user_id: string
          writer_name?: string | null
        }
        Update: {
          ai_usage_type?: string | null
          ai_used?: boolean | null
          analysis_type?: string
          character_count?: number | null
          competition_id?: string | null
          created_at?: string
          declared_influences?: string[] | null
          draft_date?: string | null
          draft_number?: string | null
          entry_id?: string | null
          human_revision_level?: number | null
          id?: string
          intended_market?: string | null
          project_title?: string
          protected_voice_concern?: boolean | null
          protected_voice_notes?: string | null
          rights_status?: string | null
          scene_count?: number | null
          source?: string
          status?: string
          text_length?: number | null
          updated_at?: string
          user_id?: string
          writer_name?: string | null
        }
        Relationships: []
      }
      batch_items: {
        Row: {
          author: string | null
          batch_job_id: string
          completed_at: string | null
          created_at: string
          entry_id: string | null
          error_message: string | null
          id: string
          source_pdf_url: string | null
          status: string
          title: string
        }
        Insert: {
          author?: string | null
          batch_job_id: string
          completed_at?: string | null
          created_at?: string
          entry_id?: string | null
          error_message?: string | null
          id?: string
          source_pdf_url?: string | null
          status?: string
          title?: string
        }
        Update: {
          author?: string | null
          batch_job_id?: string
          completed_at?: string | null
          created_at?: string
          entry_id?: string | null
          error_message?: string | null
          id?: string
          source_pdf_url?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_items_batch_job_id_fkey"
            columns: ["batch_job_id"]
            isOneToOne: false
            referencedRelation: "batch_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_items_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_items_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "batch_items_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_items_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_jobs: {
        Row: {
          completed_at: string | null
          config_json: Json
          created_at: string
          failed_items: number
          id: string
          job_type: string
          processed_items: number
          status: string
          total_items: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          config_json?: Json
          created_at?: string
          failed_items?: number
          id?: string
          job_type?: string
          processed_items?: number
          status?: string
          total_items?: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          config_json?: Json
          created_at?: string
          failed_items?: number
          id?: string
          job_type?: string
          processed_items?: number
          status?: string
          total_items?: number
          user_id?: string
        }
        Relationships: []
      }
      brain_dump_files: {
        Row: {
          brief_id: string | null
          byte_size: number | null
          char_count: number | null
          content_hash: string | null
          created_at: string
          extracted_text: string | null
          extraction_error: string | null
          extraction_status: string
          filename: string
          id: string
          mime_type: string | null
          storage_path: string
          structured: Json | null
          structured_error: string | null
          structured_parsed_at: string | null
          structured_status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          brief_id?: string | null
          byte_size?: number | null
          char_count?: number | null
          content_hash?: string | null
          created_at?: string
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_status?: string
          filename: string
          id?: string
          mime_type?: string | null
          storage_path: string
          structured?: Json | null
          structured_error?: string | null
          structured_parsed_at?: string | null
          structured_status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          brief_id?: string | null
          byte_size?: number | null
          char_count?: number | null
          content_hash?: string | null
          created_at?: string
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_status?: string
          filename?: string
          id?: string
          mime_type?: string | null
          storage_path?: string
          structured?: Json | null
          structured_error?: string | null
          structured_parsed_at?: string | null
          structured_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_dump_files_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_comment_audit: {
        Row: {
          action: string
          actor_label: string | null
          actor_user_id: string | null
          brief_id: string
          comment_id: string | null
          created_at: string
          details: Json
          id: string
          report_id: string | null
        }
        Insert: {
          action: string
          actor_label?: string | null
          actor_user_id?: string | null
          brief_id: string
          comment_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          report_id?: string | null
        }
        Update: {
          action?: string
          actor_label?: string | null
          actor_user_id?: string | null
          brief_id?: string
          comment_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          report_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brief_comment_audit_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_comment_reports: {
        Row: {
          appeal_reason: string | null
          appeal_requested_at: string | null
          appeal_resolved_at: string | null
          appeal_resolved_by: string | null
          appeal_response: string | null
          appeal_status: string
          brief_id: string
          comment_id: string
          created_at: string
          id: string
          reason: string | null
          reporter_user_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          appeal_reason?: string | null
          appeal_requested_at?: string | null
          appeal_resolved_at?: string | null
          appeal_resolved_by?: string | null
          appeal_response?: string | null
          appeal_status?: string
          brief_id: string
          comment_id: string
          created_at?: string
          id?: string
          reason?: string | null
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          appeal_reason?: string | null
          appeal_requested_at?: string | null
          appeal_resolved_at?: string | null
          appeal_resolved_by?: string | null
          appeal_response?: string | null
          appeal_status?: string
          brief_id?: string
          comment_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_comment_reports_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_comment_reports_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "brief_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_comments: {
        Row: {
          author_name: string
          author_user_id: string | null
          body: string
          brief_id: string
          created_at: string
          hidden: boolean
          id: string
          moderation_flags: string[]
          moderation_score: number | null
          parent_comment_id: string | null
          pending_approval: boolean
        }
        Insert: {
          author_name: string
          author_user_id?: string | null
          body: string
          brief_id: string
          created_at?: string
          hidden?: boolean
          id?: string
          moderation_flags?: string[]
          moderation_score?: number | null
          parent_comment_id?: string | null
          pending_approval?: boolean
        }
        Update: {
          author_name?: string
          author_user_id?: string | null
          body?: string
          brief_id?: string
          created_at?: string
          hidden?: boolean
          id?: string
          moderation_flags?: string[]
          moderation_score?: number | null
          parent_comment_id?: string | null
          pending_approval?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "brief_comments_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "brief_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_moderation_settings: {
        Row: {
          brief_id: string
          enabled: boolean
          keyword_blocklist: string[]
          max_links: number
          min_confidence: number
          min_length: number
          require_approval: boolean
          updated_at: string
        }
        Insert: {
          brief_id: string
          enabled?: boolean
          keyword_blocklist?: string[]
          max_links?: number
          min_confidence?: number
          min_length?: number
          require_approval?: boolean
          updated_at?: string
        }
        Update: {
          brief_id?: string
          enabled?: boolean
          keyword_blocklist?: string[]
          max_links?: number
          min_confidence?: number
          min_length?: number
          require_approval?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_moderation_settings_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: true
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_share_views: {
        Row: {
          brief_id: string
          created_at: string
          id: string
          referrer: string | null
          share_token: string
          surface: string
          user_agent: string | null
          viewer_user_id: string | null
          visibility: string
        }
        Insert: {
          brief_id: string
          created_at?: string
          id?: string
          referrer?: string | null
          share_token: string
          surface?: string
          user_agent?: string | null
          viewer_user_id?: string | null
          visibility: string
        }
        Update: {
          brief_id?: string
          created_at?: string
          id?: string
          referrer?: string | null
          share_token?: string
          surface?: string
          user_agent?: string | null
          viewer_user_id?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_share_views_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      burn_scenarios: {
        Row: {
          created_at: string
          expected_funding: number
          expense_growth_rate: number
          id: string
          monthly_expenses: number
          monthly_revenue: number
          name: string
          revenue_growth_rate: number
          risk_level: string | null
          runway_months: number | null
          scope_id: string
          scope_type: Database["public"]["Enums"]["cash_burn_scope"]
          starting_cash: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expected_funding?: number
          expense_growth_rate?: number
          id?: string
          monthly_expenses?: number
          monthly_revenue?: number
          name: string
          revenue_growth_rate?: number
          risk_level?: string | null
          runway_months?: number | null
          scope_id: string
          scope_type: Database["public"]["Enums"]["cash_burn_scope"]
          starting_cash?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expected_funding?: number
          expense_growth_rate?: number
          id?: string
          monthly_expenses?: number
          monthly_revenue?: number
          name?: string
          revenue_growth_rate?: number
          risk_level?: string | null
          runway_months?: number | null
          scope_id?: string
          scope_type?: Database["public"]["Enums"]["cash_burn_scope"]
          starting_cash?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      business_documents: {
        Row: {
          classification: string
          content: string
          created_at: string
          created_by: string
          doc_type: string
          id: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          classification?: string
          content?: string
          created_at?: string
          created_by: string
          doc_type?: string
          id?: string
          status?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          classification?: string
          content?: string
          created_at?: string
          created_by?: string
          doc_type?: string
          id?: string
          status?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      calibration_anchors: {
        Row: {
          active: boolean
          category: string
          created_at: string
          id: string
          label: string
          notes: string | null
          reference_dimensions: Json
          reference_score: number
          script_text: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          id?: string
          label: string
          notes?: string | null
          reference_dimensions?: Json
          reference_score: number
          script_text: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
          reference_dimensions?: Json
          reference_score?: number
          script_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      calibration_runs: {
        Row: {
          anchor_id: string
          created_at: string
          drift: number
          exceeded_threshold: boolean
          id: string
          model_id: string
          notes: string | null
          observed_dimensions: Json
          observed_score: number
        }
        Insert: {
          anchor_id: string
          created_at?: string
          drift: number
          exceeded_threshold?: boolean
          id?: string
          model_id: string
          notes?: string | null
          observed_dimensions?: Json
          observed_score: number
        }
        Update: {
          anchor_id?: string
          created_at?: string
          drift?: number
          exceeded_threshold?: boolean
          id?: string
          model_id?: string
          notes?: string | null
          observed_dimensions?: Json
          observed_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "calibration_runs_anchor_id_fkey"
            columns: ["anchor_id"]
            isOneToOne: false
            referencedRelation: "calibration_anchors"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_burn_records: {
        Row: {
          ai_api_costs: number
          cloud_costs: number
          contractors: number
          created_at: string
          custom_categories: Json
          event_costs: number
          id: string
          legal_accounting: number
          marketing: number
          miscellaneous: number
          month: string
          notes: string | null
          payroll: number
          revenue_collected: number
          scope_id: string
          scope_type: Database["public"]["Enums"]["cash_burn_scope"]
          software_tools: number
          starting_cash: number
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_api_costs?: number
          cloud_costs?: number
          contractors?: number
          created_at?: string
          custom_categories?: Json
          event_costs?: number
          id?: string
          legal_accounting?: number
          marketing?: number
          miscellaneous?: number
          month: string
          notes?: string | null
          payroll?: number
          revenue_collected?: number
          scope_id: string
          scope_type: Database["public"]["Enums"]["cash_burn_scope"]
          software_tools?: number
          starting_cash?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_api_costs?: number
          cloud_costs?: number
          contractors?: number
          created_at?: string
          custom_categories?: Json
          event_costs?: number
          id?: string
          legal_accounting?: number
          marketing?: number
          miscellaneous?: number
          month?: string
          notes?: string | null
          payroll?: number
          revenue_collected?: number
          scope_id?: string
          scope_type?: Database["public"]["Enums"]["cash_burn_scope"]
          software_tools?: number
          starting_cash?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      changelog_releases: {
        Row: {
          created_at: string
          created_by: string | null
          highlights: Json
          id: string
          is_published: boolean
          kind: string
          news_article_id: string | null
          released_at: string
          summary: string | null
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          highlights?: Json
          id?: string
          is_published?: boolean
          kind?: string
          news_article_id?: string | null
          released_at?: string
          summary?: string | null
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          highlights?: Json
          id?: string
          is_published?: boolean
          kind?: string
          news_article_id?: string | null
          released_at?: string
          summary?: string | null
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "changelog_releases_news_article_id_fkey"
            columns: ["news_article_id"]
            isOneToOne: false
            referencedRelation: "news_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_belief_events: {
        Row: {
          correlation_id: string | null
          created_at: string
          detected_by: string
          diamond_id: string
          draft_id: string | null
          entry_id: string
          event_kind: string | null
          evidence: Json
          extractor_confidence: number | null
          extractor_model_id: string | null
          id: string
          kind: string
          prompt_hash: string | null
          scene_ref: string | null
          source: string | null
          turn_label: string | null
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          detected_by: string
          diamond_id: string
          draft_id?: string | null
          entry_id: string
          event_kind?: string | null
          evidence?: Json
          extractor_confidence?: number | null
          extractor_model_id?: string | null
          id?: string
          kind: string
          prompt_hash?: string | null
          scene_ref?: string | null
          source?: string | null
          turn_label?: string | null
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          detected_by?: string
          diamond_id?: string
          draft_id?: string | null
          entry_id?: string
          event_kind?: string | null
          evidence?: Json
          extractor_confidence?: number | null
          extractor_model_id?: string | null
          id?: string
          kind?: string
          prompt_hash?: string | null
          scene_ref?: string | null
          source?: string | null
          turn_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_belief_events_diamond_id_fkey"
            columns: ["diamond_id"]
            isOneToOne: false
            referencedRelation: "character_diamonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_belief_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_belief_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "character_belief_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_belief_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_belief_events_extractor_model_id_fkey"
            columns: ["extractor_model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
        ]
      }
      character_diamond_versions: {
        Row: {
          created_at: string
          created_by: string | null
          diamond_id: string
          entry_id: string
          id: string
          reason: string
          snapshot: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          diamond_id: string
          entry_id: string
          id?: string
          reason?: string
          snapshot: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          diamond_id?: string
          entry_id?: string
          id?: string
          reason?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "character_diamond_versions_diamond_id_fkey"
            columns: ["diamond_id"]
            isOneToOne: false
            referencedRelation: "character_diamonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_diamond_versions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_diamond_versions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "character_diamond_versions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_diamond_versions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      character_diamonds: {
        Row: {
          affective: Json
          character_name: string
          confidence: number | null
          counter_star: string | null
          created_at: string
          created_by: string | null
          embedding_model: string | null
          entry_id: string
          epistemic: Json
          flaw_mask: string | null
          id: string
          last_verified_at: string | null
          latent_embedding: string | null
          model_version: string | null
          non_negotiable: string | null
          normative: Json
          north_star: string | null
          relational: Json
          source: string
          updated_at: string
          verifier_state: string
        }
        Insert: {
          affective?: Json
          character_name: string
          confidence?: number | null
          counter_star?: string | null
          created_at?: string
          created_by?: string | null
          embedding_model?: string | null
          entry_id: string
          epistemic?: Json
          flaw_mask?: string | null
          id?: string
          last_verified_at?: string | null
          latent_embedding?: string | null
          model_version?: string | null
          non_negotiable?: string | null
          normative?: Json
          north_star?: string | null
          relational?: Json
          source?: string
          updated_at?: string
          verifier_state?: string
        }
        Update: {
          affective?: Json
          character_name?: string
          confidence?: number | null
          counter_star?: string | null
          created_at?: string
          created_by?: string | null
          embedding_model?: string | null
          entry_id?: string
          epistemic?: Json
          flaw_mask?: string | null
          id?: string
          last_verified_at?: string | null
          latent_embedding?: string | null
          model_version?: string | null
          non_negotiable?: string | null
          normative?: Json
          north_star?: string | null
          relational?: Json
          source?: string
          updated_at?: string
          verifier_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_diamonds_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_diamonds_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "character_diamonds_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_diamonds_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      character_kernel_runs: {
        Row: {
          character_name: string
          contradiction: number | null
          correlation_id: string | null
          created_at: string
          decision: string
          diamond_id: string | null
          entry_id: string
          evidence_score: number | null
          function_name: string
          id: string
          model_version: string | null
          notes: string | null
          pressure: number | null
          sycophancy_risk: number | null
          threat: number | null
          user_id: string | null
        }
        Insert: {
          character_name: string
          contradiction?: number | null
          correlation_id?: string | null
          created_at?: string
          decision: string
          diamond_id?: string | null
          entry_id: string
          evidence_score?: number | null
          function_name: string
          id?: string
          model_version?: string | null
          notes?: string | null
          pressure?: number | null
          sycophancy_risk?: number | null
          threat?: number | null
          user_id?: string | null
        }
        Update: {
          character_name?: string
          contradiction?: number | null
          correlation_id?: string | null
          created_at?: string
          decision?: string
          diamond_id?: string | null
          entry_id?: string
          evidence_score?: number | null
          function_name?: string
          id?: string
          model_version?: string | null
          notes?: string | null
          pressure?: number | null
          sycophancy_risk?: number | null
          threat?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_kernel_runs_diamond_id_fkey"
            columns: ["diamond_id"]
            isOneToOne: false
            referencedRelation: "character_diamonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_kernel_runs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_kernel_runs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "character_kernel_runs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_kernel_runs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      closed_trial_applications: {
        Row: {
          created_at: string
          email: string
          experience: string
          id: string
          name: string
          origin: string
          reason: string
          reviewed_at: string | null
          reviewed_by: string | null
          role: string
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          experience?: string
          id?: string
          name: string
          origin?: string
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          role?: string
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          experience?: string
          id?: string
          name?: string
          origin?: string
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          role?: string
          status?: string
        }
        Relationships: []
      }
      club_reviews: {
        Row: {
          ai_flags: Json
          ai_rationale: string | null
          ai_verdict: string | null
          created_at: string
          cycle_id: string
          id: string
          one_improvement: string
          ratings: Json
          reward_tokens: number
          status: string
          updated_at: string
          user_id: string
          what_didnt: string
          what_worked: string
        }
        Insert: {
          ai_flags?: Json
          ai_rationale?: string | null
          ai_verdict?: string | null
          created_at?: string
          cycle_id: string
          id?: string
          one_improvement: string
          ratings: Json
          reward_tokens?: number
          status?: string
          updated_at?: string
          user_id: string
          what_didnt: string
          what_worked: string
        }
        Update: {
          ai_flags?: Json
          ai_rationale?: string | null
          ai_verdict?: string | null
          created_at?: string
          cycle_id?: string
          id?: string
          one_improvement?: string
          ratings?: Json
          reward_tokens?: number
          status?: string
          updated_at?: string
          user_id?: string
          what_didnt?: string
          what_worked?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_reviews_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "reading_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_events: {
        Row: {
          actor_id: string
          created_at: string
          entry_id: string
          event_type: string
          id: string
          metadata: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          entry_id: string
          event_type: string
          id?: string
          metadata?: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          entry_id?: string
          event_type?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "collaboration_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          entry_id: string
          expires_at: string
          id: string
          invited_by: string
          last_sent_at: string | null
          role: Database["public"]["Enums"]["collab_role"]
          send_count: number
          status: Database["public"]["Enums"]["collab_invitation_status"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          entry_id: string
          expires_at?: string
          id?: string
          invited_by: string
          last_sent_at?: string | null
          role?: Database["public"]["Enums"]["collab_role"]
          send_count?: number
          status?: Database["public"]["Enums"]["collab_invitation_status"]
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          entry_id?: string
          expires_at?: string
          id?: string
          invited_by?: string
          last_sent_at?: string | null
          role?: Database["public"]["Enums"]["collab_role"]
          send_count?: number
          status?: Database["public"]["Enums"]["collab_invitation_status"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_invitations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_invitations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "collaborator_invitations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_invitations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_economics: {
        Row: {
          competition_id: string
          created_at: string
          entry_fees: Json
          id: string
          locked: boolean
          locked_at: string | null
          preview_assumptions: Json
          prize_pool_pct: number
          surcharge_overrides: Json
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          entry_fees?: Json
          id?: string
          locked?: boolean
          locked_at?: string | null
          preview_assumptions?: Json
          prize_pool_pct?: number
          surcharge_overrides?: Json
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          entry_fees?: Json
          id?: string
          locked?: boolean
          locked_at?: string | null
          preview_assumptions?: Json
          prize_pool_pct?: number
          surcharge_overrides?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_economics_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: true
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_judge_config: {
        Row: {
          awards: Json
          competition_id: string
          created_at: string
          custom_api_base_url: string | null
          custom_api_key_encrypted: string | null
          finalized: boolean
          finalized_at: string | null
          finalized_by: string | null
          guidelines: string | null
          id: string
          judging_mode: string
          locked: boolean
          locked_at: string | null
          max_variance_allowed: number
          min_judges_required: number
          mode_settings: Json
          model_id: string
          model_provider: string
          rubric_preset: string
          rubric_version: number | null
          rules: string | null
          scoring_weights: Json
          stipulations: Json
          updated_at: string
        }
        Insert: {
          awards?: Json
          competition_id: string
          created_at?: string
          custom_api_base_url?: string | null
          custom_api_key_encrypted?: string | null
          finalized?: boolean
          finalized_at?: string | null
          finalized_by?: string | null
          guidelines?: string | null
          id?: string
          judging_mode?: string
          locked?: boolean
          locked_at?: string | null
          max_variance_allowed?: number
          min_judges_required?: number
          mode_settings?: Json
          model_id?: string
          model_provider?: string
          rubric_preset?: string
          rubric_version?: number | null
          rules?: string | null
          scoring_weights?: Json
          stipulations?: Json
          updated_at?: string
        }
        Update: {
          awards?: Json
          competition_id?: string
          created_at?: string
          custom_api_base_url?: string | null
          custom_api_key_encrypted?: string | null
          finalized?: boolean
          finalized_at?: string | null
          finalized_by?: string | null
          guidelines?: string | null
          id?: string
          judging_mode?: string
          locked?: boolean
          locked_at?: string | null
          max_variance_allowed?: number
          min_judges_required?: number
          mode_settings?: Json
          model_id?: string
          model_provider?: string
          rubric_preset?: string
          rubric_version?: number | null
          rules?: string | null
          scoring_weights?: Json
          stipulations?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_judge_config_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: true
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_judges: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          competition_id: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          competition_id: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          competition_id?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_judges_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_partners: {
        Row: {
          can_view_embargoed: boolean
          competition_id: string
          created_at: string
          granted_by: string | null
          id: string
          notes: string | null
          partner_role: Database["public"]["Enums"]["app_role"]
          partner_user_id: string
          updated_at: string
        }
        Insert: {
          can_view_embargoed?: boolean
          competition_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          notes?: string | null
          partner_role: Database["public"]["Enums"]["app_role"]
          partner_user_id: string
          updated_at?: string
        }
        Update: {
          can_view_embargoed?: boolean
          competition_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          notes?: string | null
          partner_role?: Database["public"]["Enums"]["app_role"]
          partner_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_partners_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          blind_review: boolean
          created_at: string
          description: string | null
          festival_id: string | null
          id: string
          judging_tier: Database["public"]["Enums"]["judging_tier"]
          kind: Database["public"]["Enums"]["competition_kind"]
          name: string
          prompt: string
          sensitivity: string
          slug: string | null
          status: Database["public"]["Enums"]["competition_status"]
          updated_at: string
        }
        Insert: {
          blind_review?: boolean
          created_at?: string
          description?: string | null
          festival_id?: string | null
          id?: string
          judging_tier?: Database["public"]["Enums"]["judging_tier"]
          kind?: Database["public"]["Enums"]["competition_kind"]
          name: string
          prompt: string
          sensitivity?: string
          slug?: string | null
          status?: Database["public"]["Enums"]["competition_status"]
          updated_at?: string
        }
        Update: {
          blind_review?: boolean
          created_at?: string
          description?: string | null
          festival_id?: string | null
          id?: string
          judging_tier?: Database["public"]["Enums"]["judging_tier"]
          kind?: Database["public"]["Enums"]["competition_kind"]
          name?: string
          prompt?: string
          sensitivity?: string
          slug?: string | null
          status?: Database["public"]["Enums"]["competition_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitions_festival_id_fkey"
            columns: ["festival_id"]
            isOneToOne: false
            referencedRelation: "festivals"
            referencedColumns: ["id"]
          },
        ]
      }
      context_bundles: {
        Row: {
          built_by: string | null
          continuity_node_id: string | null
          continuity_verdict: string | null
          created_at: string
          entry_id: string | null
          id: string
          mode: string | null
          output_request: Json
          payload_canonical_text: string | null
          payload_hash: string
          payload_json: Json
          prev_hash: string | null
          project_id: string
          provenance_hash: string | null
          story_plan_hash: string | null
          token_count: number | null
        }
        Insert: {
          built_by?: string | null
          continuity_node_id?: string | null
          continuity_verdict?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          mode?: string | null
          output_request?: Json
          payload_canonical_text?: string | null
          payload_hash: string
          payload_json: Json
          prev_hash?: string | null
          project_id: string
          provenance_hash?: string | null
          story_plan_hash?: string | null
          token_count?: number | null
        }
        Update: {
          built_by?: string | null
          continuity_node_id?: string | null
          continuity_verdict?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          mode?: string | null
          output_request?: Json
          payload_canonical_text?: string | null
          payload_hash?: string
          payload_json?: Json
          prev_hash?: string | null
          project_id?: string
          provenance_hash?: string | null
          story_plan_hash?: string | null
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "context_bundles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      demo_access_requests: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          reason: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: []
      }
      document_versions: {
        Row: {
          content: string
          created_at: string
          document_id: string
          id: string
          saved_by: string
          status: string
          title: string
          version: number
        }
        Insert: {
          content?: string
          created_at?: string
          document_id: string
          id?: string
          saved_by: string
          status?: string
          title: string
          version: number
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          id?: string
          saved_by?: string
          status?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "business_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_triggers: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          event_key: string
          recipient_resolver: string
          requires_role: string
          template_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          event_key: string
          recipient_resolver?: string
          requires_role?: string
          template_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          event_key?: string
          recipient_resolver?: string
          requires_role?: string
          template_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      entries: {
        Row: {
          ai_fields: Json | null
          ai_tools_used: string[] | null
          author: string | null
          bulk_notes: string | null
          co_author: string | null
          competition_id: string | null
          created_at: string
          dev_stage: Database["public"]["Enums"]["dev_stage"]
          director_name: string | null
          draft_number: number
          embargo_until: string | null
          evidence_bundle_hash: string | null
          external_script_url: string | null
          film_title: string | null
          genre: string | null
          id: string
          import_batch_id: string | null
          imported_by: string | null
          judging_tier: Database["public"]["Enums"]["judging_tier"]
          length_category: string | null
          logline: string | null
          method_type: Database["public"]["Enums"]["method_type"]
          model_used: string | null
          page_count: number | null
          parent_entry_id: string | null
          parsed_metadata: Json | null
          pdf_url: string | null
          poster_url: string | null
          production_notes: string | null
          rubric_preset: string
          rubric_version: number | null
          runtime_seconds: number | null
          script_text: string | null
          sensitivity: string
          sharing_mode: string
          source: string
          status: Database["public"]["Enums"]["entry_status"]
          synopsis: string | null
          title: string
          updated_at: string
          user_id: string
          video_url: string | null
          visibility: string
          writer_email: string | null
          writer_name: string | null
        }
        Insert: {
          ai_fields?: Json | null
          ai_tools_used?: string[] | null
          author?: string | null
          bulk_notes?: string | null
          co_author?: string | null
          competition_id?: string | null
          created_at?: string
          dev_stage?: Database["public"]["Enums"]["dev_stage"]
          director_name?: string | null
          draft_number?: number
          embargo_until?: string | null
          evidence_bundle_hash?: string | null
          external_script_url?: string | null
          film_title?: string | null
          genre?: string | null
          id?: string
          import_batch_id?: string | null
          imported_by?: string | null
          judging_tier?: Database["public"]["Enums"]["judging_tier"]
          length_category?: string | null
          logline?: string | null
          method_type?: Database["public"]["Enums"]["method_type"]
          model_used?: string | null
          page_count?: number | null
          parent_entry_id?: string | null
          parsed_metadata?: Json | null
          pdf_url?: string | null
          poster_url?: string | null
          production_notes?: string | null
          rubric_preset?: string
          rubric_version?: number | null
          runtime_seconds?: number | null
          script_text?: string | null
          sensitivity?: string
          sharing_mode?: string
          source?: string
          status?: Database["public"]["Enums"]["entry_status"]
          synopsis?: string | null
          title: string
          updated_at?: string
          user_id: string
          video_url?: string | null
          visibility?: string
          writer_email?: string | null
          writer_name?: string | null
        }
        Update: {
          ai_fields?: Json | null
          ai_tools_used?: string[] | null
          author?: string | null
          bulk_notes?: string | null
          co_author?: string | null
          competition_id?: string | null
          created_at?: string
          dev_stage?: Database["public"]["Enums"]["dev_stage"]
          director_name?: string | null
          draft_number?: number
          embargo_until?: string | null
          evidence_bundle_hash?: string | null
          external_script_url?: string | null
          film_title?: string | null
          genre?: string | null
          id?: string
          import_batch_id?: string | null
          imported_by?: string | null
          judging_tier?: Database["public"]["Enums"]["judging_tier"]
          length_category?: string | null
          logline?: string | null
          method_type?: Database["public"]["Enums"]["method_type"]
          model_used?: string | null
          page_count?: number | null
          parent_entry_id?: string | null
          parsed_metadata?: Json | null
          pdf_url?: string | null
          poster_url?: string | null
          production_notes?: string | null
          rubric_preset?: string
          rubric_version?: number | null
          runtime_seconds?: number | null
          script_text?: string | null
          sensitivity?: string
          sharing_mode?: string
          source?: string
          status?: Database["public"]["Enums"]["entry_status"]
          synopsis?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          video_url?: string | null
          visibility?: string
          writer_email?: string | null
          writer_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entries_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_parent_entry_id_fkey"
            columns: ["parent_entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_parent_entry_id_fkey"
            columns: ["parent_entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "entries_parent_entry_id_fkey"
            columns: ["parent_entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_parent_entry_id_fkey"
            columns: ["parent_entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_brief_messages: {
        Row: {
          body: string
          brief_id: string | null
          brief_version_id: string | null
          created_at: string
          entry_id: string
          id: string
          kind: string
          source: string
          user_id: string
        }
        Insert: {
          body: string
          brief_id?: string | null
          brief_version_id?: string | null
          created_at?: string
          entry_id: string
          id?: string
          kind?: string
          source?: string
          user_id: string
        }
        Update: {
          body?: string
          brief_id?: string | null
          brief_version_id?: string | null
          created_at?: string
          entry_id?: string
          id?: string
          kind?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_brief_messages_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_brief_messages_brief_version_id_fkey"
            columns: ["brief_version_id"]
            isOneToOne: false
            referencedRelation: "project_brief_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_brief_messages_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_brief_messages_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "entry_brief_messages_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_brief_messages_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_finalize_checklist: {
        Row: {
          coi_clear: boolean
          current_variance: number | null
          entry_id: string
          judge_sample_count: number
          lead_review_notes: string | null
          lead_reviewed_at: string | null
          lead_reviewed_by: string | null
          panel_resolved: boolean
          quorum_met: boolean
          recusals_clear: boolean
          rubric_complete: boolean
          updated_at: string
          variance_ok: boolean
        }
        Insert: {
          coi_clear?: boolean
          current_variance?: number | null
          entry_id: string
          judge_sample_count?: number
          lead_review_notes?: string | null
          lead_reviewed_at?: string | null
          lead_reviewed_by?: string | null
          panel_resolved?: boolean
          quorum_met?: boolean
          recusals_clear?: boolean
          rubric_complete?: boolean
          updated_at?: string
          variance_ok?: boolean
        }
        Update: {
          coi_clear?: boolean
          current_variance?: number | null
          entry_id?: string
          judge_sample_count?: number
          lead_review_notes?: string | null
          lead_reviewed_at?: string | null
          lead_reviewed_by?: string | null
          panel_resolved?: boolean
          quorum_met?: boolean
          recusals_clear?: boolean
          rubric_complete?: boolean
          updated_at?: string
          variance_ok?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "entry_finalize_checklist_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_finalize_checklist_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "entry_finalize_checklist_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_finalize_checklist_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_runs: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          model_used: string
          quotient_scores_json: Json
          temperature: number | null
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          model_used: string
          quotient_scores_json?: Json
          temperature?: number | null
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          model_used?: string
          quotient_scores_json?: Json
          temperature?: number | null
        }
        Relationships: []
      }
      evidence_replay_flags: {
        Row: {
          context_id: string | null
          context_kind: string
          created_at: string
          expected_evidence_hash: string
          function_name: string
          id: string
          kind: string
          notes: Json | null
          observed_evidence_hash: string
          principal_id: string | null
          query_hash: string
        }
        Insert: {
          context_id?: string | null
          context_kind?: string
          created_at?: string
          expected_evidence_hash: string
          function_name: string
          id?: string
          kind: string
          notes?: Json | null
          observed_evidence_hash: string
          principal_id?: string | null
          query_hash: string
        }
        Update: {
          context_id?: string | null
          context_kind?: string
          created_at?: string
          expected_evidence_hash?: string
          function_name?: string
          id?: string
          kind?: string
          notes?: Json | null
          observed_evidence_hash?: string
          principal_id?: string | null
          query_hash?: string
        }
        Relationships: []
      }
      feature_configs: {
        Row: {
          enabled: boolean
          id: string
          model_hint: string | null
          monthly_cost: number
          subscribable: boolean
          tier: string
          token_cost: number
          updated_at: string
          usage_policy: Json
          weekly_cost: number
          yearly_cost: number
        }
        Insert: {
          enabled?: boolean
          id: string
          model_hint?: string | null
          monthly_cost?: number
          subscribable?: boolean
          tier?: string
          token_cost?: number
          updated_at?: string
          usage_policy?: Json
          weekly_cost?: number
          yearly_cost?: number
        }
        Update: {
          enabled?: boolean
          id?: string
          model_hint?: string | null
          monthly_cost?: number
          subscribable?: boolean
          tier?: string
          token_cost?: number
          updated_at?: string
          usage_policy?: Json
          weekly_cost?: number
          yearly_cost?: number
        }
        Relationships: []
      }
      feature_roadmap: {
        Row: {
          created_at: string
          description: string | null
          id: string
          release_notes_article_id: string | null
          released_at: string | null
          sort_order: number
          status: string
          target_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          release_notes_article_id?: string | null
          released_at?: string | null
          sort_order?: number
          status?: string
          target_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          release_notes_article_id?: string | null
          released_at?: string | null
          sort_order?: number
          status?: string
          target_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_roadmap_release_notes_article_id_fkey"
            columns: ["release_notes_article_id"]
            isOneToOne: false
            referencedRelation: "news_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_subscriptions: {
        Row: {
          auto_renew: boolean
          cancelled_at: string | null
          created_at: string
          cycle: string
          cycle_end: string
          cycle_start: string
          feature_id: string
          id: string
          refund_amount: number | null
          tokens_paid: number
          user_id: string
        }
        Insert: {
          auto_renew?: boolean
          cancelled_at?: string | null
          created_at?: string
          cycle?: string
          cycle_end: string
          cycle_start?: string
          feature_id: string
          id?: string
          refund_amount?: number | null
          tokens_paid?: number
          user_id: string
        }
        Update: {
          auto_renew?: boolean
          cancelled_at?: string | null
          created_at?: string
          cycle?: string
          cycle_end?: string
          cycle_start?: string
          feature_id?: string
          id?: string
          refund_amount?: number | null
          tokens_paid?: number
          user_id?: string
        }
        Relationships: []
      }
      feature_usage_log: {
        Row: {
          action: string
          applied: boolean
          correlation_id: string | null
          created_at: string
          entry_id: string | null
          id: string
          input_text: string | null
          metadata: Json | null
          output_text: string | null
          parent_log_id: string | null
          tokens_spent: number
          user_id: string
        }
        Insert: {
          action: string
          applied?: boolean
          correlation_id?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          input_text?: string | null
          metadata?: Json | null
          output_text?: string | null
          parent_log_id?: string | null
          tokens_spent?: number
          user_id: string
        }
        Update: {
          action?: string
          applied?: boolean
          correlation_id?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          input_text?: string | null
          metadata?: Json | null
          output_text?: string | null
          parent_log_id?: string | null
          tokens_spent?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_usage_log_parent_log_id_fkey"
            columns: ["parent_log_id"]
            isOneToOne: false
            referencedRelation: "feature_usage_log"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_votes: {
        Row: {
          created_at: string
          feature_id: string
          id: string
          tokens_bid: number
          user_id: string
        }
        Insert: {
          created_at?: string
          feature_id: string
          id?: string
          tokens_bid?: number
          user_id: string
        }
        Update: {
          created_at?: string
          feature_id?: string
          id?: string
          tokens_bid?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_votes_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "feature_roadmap"
            referencedColumns: ["id"]
          },
        ]
      }
      festival_ad_slots: {
        Row: {
          advertiser_email: string
          advertiser_name: string
          bid_amount_cents: number
          created_at: string
          festival_id: string | null
          id: string
          notes: string
          slot_end: string | null
          slot_start: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          advertiser_email: string
          advertiser_name: string
          bid_amount_cents: number
          created_at?: string
          festival_id?: string | null
          id?: string
          notes?: string
          slot_end?: string | null
          slot_start?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          advertiser_email?: string
          advertiser_name?: string
          bid_amount_cents?: number
          created_at?: string
          festival_id?: string | null
          id?: string
          notes?: string
          slot_end?: string | null
          slot_start?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "festival_ad_slots_festival_id_fkey"
            columns: ["festival_id"]
            isOneToOne: false
            referencedRelation: "festivals"
            referencedColumns: ["id"]
          },
        ]
      }
      festivals: {
        Row: {
          created_at: string
          cta_url: string
          icon: string
          id: string
          is_sponsored: boolean
          pitch: string
          season_id: string | null
          sort_order: number
          sponsor_label: string | null
          status: string
          subtitle: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cta_url?: string
          icon?: string
          id?: string
          is_sponsored?: boolean
          pitch?: string
          season_id?: string | null
          sort_order?: number
          sponsor_label?: string | null
          status?: string
          subtitle?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cta_url?: string
          icon?: string
          id?: string
          is_sponsored?: boolean
          pitch?: string
          season_id?: string | null
          sort_order?: number
          sponsor_label?: string | null
          status?: string
          subtitle?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "festivals_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      fine_tune_disclosures: {
        Row: {
          created_at: string
          declared_author: string | null
          declared_model: string | null
          disclosure_type: string
          entry_id: string | null
          has_permission: boolean
          id: string
          notes: string | null
          screenplay_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          declared_author?: string | null
          declared_model?: string | null
          disclosure_type: string
          entry_id?: string | null
          has_permission?: boolean
          id?: string
          notes?: string | null
          screenplay_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          declared_author?: string | null
          declared_model?: string | null
          disclosure_type?: string
          entry_id?: string | null
          has_permission?: boolean
          id?: string
          notes?: string | null
          screenplay_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      governance_events: {
        Row: {
          correlation_id: string | null
          created_at: string
          entry_id: string | null
          event_status: string
          event_type: string
          execution_id: string | null
          id: string
          metadata_json: Json
          model_name: string | null
          prev_hash: string | null
          privacy_mode: string | null
          provider: string | null
          routing_reason: string | null
          row_hash: string | null
          version_id: string | null
          workspace_probe_kind: string | null
          workspace_probe_payload: Json | null
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          entry_id?: string | null
          event_status?: string
          event_type: string
          execution_id?: string | null
          id?: string
          metadata_json?: Json
          model_name?: string | null
          prev_hash?: string | null
          privacy_mode?: string | null
          provider?: string | null
          routing_reason?: string | null
          row_hash?: string | null
          version_id?: string | null
          workspace_probe_kind?: string | null
          workspace_probe_payload?: Json | null
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          entry_id?: string | null
          event_status?: string
          event_type?: string
          execution_id?: string | null
          id?: string
          metadata_json?: Json
          model_name?: string | null
          prev_hash?: string | null
          privacy_mode?: string | null
          provider?: string | null
          routing_reason?: string | null
          row_hash?: string | null
          version_id?: string | null
          workspace_probe_kind?: string | null
          workspace_probe_payload?: Json | null
        }
        Relationships: []
      }
      grading_reports: {
        Row: {
          character_depth: number
          created_at: string
          dialogue: number
          emotion: number
          entry_id: string
          feedback: string | null
          format_adherence: number
          id: string
          market: number | null
          model_id: string
          originality: number
          rubric_preset: string | null
          rubric_version: number | null
          structure: number
          theme: number
          total_score: number
          visual: number | null
        }
        Insert: {
          character_depth?: number
          created_at?: string
          dialogue?: number
          emotion?: number
          entry_id: string
          feedback?: string | null
          format_adherence?: number
          id?: string
          market?: number | null
          model_id: string
          originality?: number
          rubric_preset?: string | null
          rubric_version?: number | null
          structure?: number
          theme?: number
          total_score?: number
          visual?: number | null
        }
        Update: {
          character_depth?: number
          created_at?: string
          dialogue?: number
          emotion?: number
          entry_id?: string
          feedback?: string | null
          format_adherence?: number
          id?: string
          market?: number | null
          model_id?: string
          originality?: number
          rubric_preset?: string | null
          rubric_version?: number | null
          structure?: number
          theme?: number
          total_score?: number
          visual?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "grading_reports_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grading_reports_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "grading_reports_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grading_reports_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      influence_scores: {
        Row: {
          ai_influence_score: number | null
          created_at: string
          entry_id: string
          id: string
          metadata_json: Json
          originality_distance_score: number | null
          scoring_method: string
          semantic_drift_score: number | null
          structural_integrity_score: number | null
          version_id: string
          voice_stability_score: number | null
        }
        Insert: {
          ai_influence_score?: number | null
          created_at?: string
          entry_id: string
          id?: string
          metadata_json?: Json
          originality_distance_score?: number | null
          scoring_method?: string
          semantic_drift_score?: number | null
          structural_integrity_score?: number | null
          version_id: string
          voice_stability_score?: number | null
        }
        Update: {
          ai_influence_score?: number | null
          created_at?: string
          entry_id?: string
          id?: string
          metadata_json?: Json
          originality_distance_score?: number | null
          scoring_method?: string
          semantic_drift_score?: number | null
          structural_integrity_score?: number | null
          version_id?: string
          voice_stability_score?: number | null
        }
        Relationships: []
      }
      judge_checklist_state: {
        Row: {
          completed_count: number
          created_at: string
          derived_state: string | null
          entry_id: string
          id: string
          rubric_preset: string | null
          rubric_version: number | null
          steps: Json
          total_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_count?: number
          created_at?: string
          derived_state?: string | null
          entry_id: string
          id?: string
          rubric_preset?: string | null
          rubric_version?: number | null
          steps?: Json
          total_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_count?: number
          created_at?: string
          derived_state?: string | null
          entry_id?: string
          id?: string
          rubric_preset?: string | null
          rubric_version?: number | null
          steps?: Json
          total_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      judge_coi_attestations: {
        Row: {
          attested_at: string
          entry_id: string
          has_conflict: boolean
          id: string
          judge_user_id: string
          note: string | null
        }
        Insert: {
          attested_at?: string
          entry_id: string
          has_conflict: boolean
          id?: string
          judge_user_id: string
          note?: string | null
        }
        Update: {
          attested_at?: string
          entry_id?: string
          has_conflict?: boolean
          id?: string
          judge_user_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "judge_coi_attestations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_coi_attestations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_coi_attestations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_coi_attestations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      judge_consensus: {
        Row: {
          consensus_final: number | null
          consensus_variance: number | null
          created_at: string
          dimension_scores: Json
          entropy_avg: number | null
          entry_id: string
          expected_scores: Json | null
          id: string
          is_outlier: boolean
          is_stability_rerun: boolean
          judging_tier: Database["public"]["Enums"]["judging_tier"]
          logprob_source: string | null
          model_id: string
          reasoning: string | null
          roll_index: number
          rubric_preset: string | null
          rubric_version: number | null
          score_distributions: Json | null
          temperature: number
          total_score: number | null
        }
        Insert: {
          consensus_final?: number | null
          consensus_variance?: number | null
          created_at?: string
          dimension_scores?: Json
          entropy_avg?: number | null
          entry_id: string
          expected_scores?: Json | null
          id?: string
          is_outlier?: boolean
          is_stability_rerun?: boolean
          judging_tier?: Database["public"]["Enums"]["judging_tier"]
          logprob_source?: string | null
          model_id: string
          reasoning?: string | null
          roll_index: number
          rubric_preset?: string | null
          rubric_version?: number | null
          score_distributions?: Json | null
          temperature?: number
          total_score?: number | null
        }
        Update: {
          consensus_final?: number | null
          consensus_variance?: number | null
          created_at?: string
          dimension_scores?: Json
          entropy_avg?: number | null
          entry_id?: string
          expected_scores?: Json | null
          id?: string
          is_outlier?: boolean
          is_stability_rerun?: boolean
          judging_tier?: Database["public"]["Enums"]["judging_tier"]
          logprob_source?: string | null
          model_id?: string
          reasoning?: string | null
          roll_index?: number
          rubric_preset?: string | null
          rubric_version?: number | null
          score_distributions?: Json | null
          temperature?: number
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "judge_consensus_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_consensus_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_consensus_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_consensus_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      judge_consensus_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          consensus_id: string | null
          created_at: string
          dimension_diff: Json | null
          entry_id: string
          id: string
          model_id: string | null
          total_score_after: number | null
          total_score_before: number | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          consensus_id?: string | null
          created_at?: string
          dimension_diff?: Json | null
          entry_id: string
          id?: string
          model_id?: string | null
          total_score_after?: number | null
          total_score_before?: number | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          consensus_id?: string | null
          created_at?: string
          dimension_diff?: Json | null
          entry_id?: string
          id?: string
          model_id?: string | null
          total_score_after?: number | null
          total_score_before?: number | null
        }
        Relationships: []
      }
      judge_panel_comments: {
        Row: {
          author_id: string
          body: string
          competition_id: string | null
          created_at: string
          dimension_key: string | null
          edited_at: string | null
          entry_id: string
          id: string
          parent_id: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          author_id: string
          body: string
          competition_id?: string | null
          created_at?: string
          dimension_key?: string | null
          edited_at?: string | null
          entry_id: string
          id?: string
          parent_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          competition_id?: string | null
          created_at?: string
          dimension_key?: string | null
          edited_at?: string | null
          entry_id?: string
          id?: string
          parent_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "judge_panel_comments_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_panel_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_panel_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_panel_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_panel_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_panel_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "judge_panel_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      judge_recusals: {
        Row: {
          created_at: string
          created_by: string
          entry_id: string
          id: string
          judge_user_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          created_by: string
          entry_id: string
          id?: string
          judge_user_id: string
          reason: string
        }
        Update: {
          created_at?: string
          created_by?: string
          entry_id?: string
          id?: string
          judge_user_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "judge_recusals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_recusals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_recusals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_recusals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      judge_usage_log: {
        Row: {
          competition_id: string
          completion_tokens: number | null
          created_at: string
          entry_id: string
          estimated_cost_cents: number | null
          id: string
          model_id: string
          prompt_tokens: number | null
        }
        Insert: {
          competition_id: string
          completion_tokens?: number | null
          created_at?: string
          entry_id: string
          estimated_cost_cents?: number | null
          id?: string
          model_id: string
          prompt_tokens?: number | null
        }
        Update: {
          competition_id?: string
          completion_tokens?: number | null
          created_at?: string
          entry_id?: string
          estimated_cost_cents?: number | null
          id?: string
          model_id?: string
          prompt_tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "judge_usage_log_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_usage_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_usage_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_usage_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_usage_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_concepts: {
        Row: {
          concept_type: string
          confidence: number | null
          created_at: string
          description: string | null
          document_id: string | null
          id: string
          title: string
        }
        Insert: {
          concept_type?: string
          confidence?: number | null
          created_at?: string
          description?: string | null
          document_id?: string | null
          id?: string
          title: string
        }
        Update: {
          concept_type?: string
          confidence?: number | null
          created_at?: string
          description?: string | null
          document_id?: string | null
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_concepts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          content: string | null
          created_at: string
          created_by: string | null
          doc_type: string
          id: string
          source: string | null
          source_url: string | null
          status: string
          summary: string | null
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: string
          id?: string
          source?: string | null
          source_url?: string | null
          status?: string
          summary?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: string
          id?: string
          source?: string | null
          source_url?: string | null
          status?: string
          summary?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_links: {
        Row: {
          concept_id: string | null
          created_at: string
          document_id: string | null
          id: string
          link_type: string
          notes: string | null
          target_id: string | null
          target_system: string
        }
        Insert: {
          concept_id?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          link_type?: string
          notes?: string | null
          target_id?: string | null
          target_system: string
        }
        Update: {
          concept_id?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          link_type?: string
          notes?: string | null
          target_id?: string | null
          target_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_links_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "knowledge_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_page_config: {
        Row: {
          cta_text: string
          cta_url: string
          grid_columns: number
          id: string
          launch_date: string | null
          maintenance_eta: string | null
          max_visible_cards: number
          season_id: string | null
          section_description: string
          section_label: string
          section_title: string
          updated_at: string
        }
        Insert: {
          cta_text?: string
          cta_url?: string
          grid_columns?: number
          id: string
          launch_date?: string | null
          maintenance_eta?: string | null
          max_visible_cards?: number
          season_id?: string | null
          section_description?: string
          section_label?: string
          section_title?: string
          updated_at?: string
        }
        Update: {
          cta_text?: string
          cta_url?: string
          grid_columns?: number
          id?: string
          launch_date?: string | null
          maintenance_eta?: string | null
          max_visible_cards?: number
          season_id?: string | null
          section_description?: string
          section_label?: string
          section_title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "landing_page_config_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      linear_event_log: {
        Row: {
          error: string | null
          event_type: string | null
          id: string
          linear_id: string | null
          payload: Json
          processed: boolean
          received_at: string
        }
        Insert: {
          error?: string | null
          event_type?: string | null
          id?: string
          linear_id?: string | null
          payload: Json
          processed?: boolean
          received_at?: string
        }
        Update: {
          error?: string | null
          event_type?: string | null
          id?: string
          linear_id?: string | null
          payload?: Json
          processed?: boolean
          received_at?: string
        }
        Relationships: []
      }
      linear_tickets: {
        Row: {
          assignee: string | null
          closed_at: string | null
          correlation_id: string | null
          created_at: string
          dedup_key: string | null
          event_count: number
          id: string
          identifier: string | null
          labels: string[] | null
          last_event_at: string
          linear_id: string | null
          payload: Json | null
          priority: number | null
          source: Database["public"]["Enums"]["linear_ticket_source"]
          source_record_id: string | null
          source_table: string | null
          state: string | null
          team_key: string | null
          throttle_until: string | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          assignee?: string | null
          closed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          dedup_key?: string | null
          event_count?: number
          id?: string
          identifier?: string | null
          labels?: string[] | null
          last_event_at?: string
          linear_id?: string | null
          payload?: Json | null
          priority?: number | null
          source: Database["public"]["Enums"]["linear_ticket_source"]
          source_record_id?: string | null
          source_table?: string | null
          state?: string | null
          team_key?: string | null
          throttle_until?: string | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          assignee?: string | null
          closed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          dedup_key?: string | null
          event_count?: number
          id?: string
          identifier?: string | null
          labels?: string[] | null
          last_event_at?: string
          linear_id?: string | null
          payload?: Json | null
          priority?: number | null
          source?: Database["public"]["Enums"]["linear_ticket_source"]
          source_record_id?: string | null
          source_table?: string | null
          state?: string | null
          team_key?: string | null
          throttle_until?: string | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      model_preferences: {
        Row: {
          enabled: boolean
          id: string
          model_id: string
          role_context: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id?: string
          model_id: string
          role_context?: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: string
          model_id?: string
          role_context?: string
          updated_at?: string
        }
        Relationships: []
      }
      model_surcharges: {
        Row: {
          enabled: boolean
          flat_surcharge: number
          multiplier: number
          tier: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          flat_surcharge?: number
          multiplier?: number
          tier: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          flat_surcharge?: number
          multiplier?: number
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      module_configs: {
        Row: {
          enabled: boolean
          id: string
          label: string
          tier: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id: string
          label: string
          tier?: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: string
          label?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      narrative_gate_shadow_labels: {
        Row: {
          created_at: string
          entry_id: string
          governance_event_id: string | null
          id: string
          labeled_by: string | null
          notes: string | null
          source: string
          truth_has_violation: boolean | null
          updated_at: string
          verdict: string | null
          violation_count: number
        }
        Insert: {
          created_at?: string
          entry_id: string
          governance_event_id?: string | null
          id?: string
          labeled_by?: string | null
          notes?: string | null
          source?: string
          truth_has_violation?: boolean | null
          updated_at?: string
          verdict?: string | null
          violation_count?: number
        }
        Update: {
          created_at?: string
          entry_id?: string
          governance_event_id?: string | null
          id?: string
          labeled_by?: string | null
          notes?: string | null
          source?: string
          truth_has_violation?: boolean | null
          updated_at?: string
          verdict?: string | null
          violation_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "narrative_gate_shadow_labels_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narrative_gate_shadow_labels_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "narrative_gate_shadow_labels_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narrative_gate_shadow_labels_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narrative_gate_shadow_labels_governance_event_id_fkey"
            columns: ["governance_event_id"]
            isOneToOne: false
            referencedRelation: "governance_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narrative_gate_shadow_labels_governance_event_id_fkey"
            columns: ["governance_event_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["governance_event_id"]
          },
        ]
      }
      news_articles: {
        Row: {
          body: string
          category: string
          created_at: string
          created_by: string | null
          excerpt: string
          id: string
          pinned: boolean
          published_at: string | null
          slug: string
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          excerpt?: string
          id?: string
          pinned?: boolean
          published_at?: string | null
          slug: string
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          excerpt?: string
          id?: string
          pinned?: boolean
          published_at?: string | null
          slug?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      news_subscriptions: {
        Row: {
          categories: string[]
          created_at: string
          email_opt_in: boolean
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          categories?: string[]
          created_at?: string
          email_opt_in?: boolean
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          categories?: string[]
          created_at?: string
          email_opt_in?: boolean
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      organize_jobs: {
        Row: {
          canceled_at: string | null
          correlation_id: string | null
          created_at: string
          entry_id: string | null
          error: string | null
          finished_at: string | null
          hints: Json
          id: string
          model: string | null
          raw_text_hash: string | null
          result: Json | null
          stage: string | null
          status: string
          tokens_spent_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          canceled_at?: string | null
          correlation_id?: string | null
          created_at?: string
          entry_id?: string | null
          error?: string | null
          finished_at?: string | null
          hints?: Json
          id: string
          model?: string | null
          raw_text_hash?: string | null
          result?: Json | null
          stage?: string | null
          status?: string
          tokens_spent_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          canceled_at?: string | null
          correlation_id?: string | null
          created_at?: string
          entry_id?: string | null
          error?: string | null
          finished_at?: string | null
          hints?: Json
          id?: string
          model?: string | null
          raw_text_hash?: string | null
          result?: Json | null
          stage?: string | null
          status?: string
          tokens_spent_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      panel_threshold_notifications: {
        Row: {
          entry_id: string
          id: string
          median_value: number
          notified_at: string
          threshold: number
        }
        Insert: {
          entry_id: string
          id?: string
          median_value: number
          notified_at?: string
          threshold: number
        }
        Update: {
          entry_id?: string
          id?: string
          median_value?: number
          notified_at?: string
          threshold?: number
        }
        Relationships: [
          {
            foreignKeyName: "panel_threshold_notifications_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panel_threshold_notifications_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "panel_threshold_notifications_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panel_threshold_notifications_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      parity_deals: {
        Row: {
          cam_fee_pct: number
          created_at: string
          cross_collateralize: boolean
          custom_collection_account_note: string | null
          custom_forum: string | null
          custom_governing_law: string | null
          custom_reserved_rights_caveat: string | null
          custom_residuals_body: string | null
          custom_withholding_note: string | null
          deferred_payroll_usd: number
          distribution_fee_pct: number
          entry_id: string | null
          foreign_sales_commission_pct: number
          hurdle_multiple: number
          id: string
          investor_capital_usd: number
          is_enabled: boolean
          jurisdiction: string
          notes: string | null
          overhead_cap_usd: number
          owner_id: string
          pa_cap_usd: number
          parity_day_rate_usd: number
          pool_contributor_pct: number
          pool_creator_ip_pct: number
          pool_investor_tail_pct: number
          reserved_rights: Json
          residuals_pct: number
          sag_tier_note: string | null
          universe_id: string | null
          updated_at: string
        }
        Insert: {
          cam_fee_pct?: number
          created_at?: string
          cross_collateralize?: boolean
          custom_collection_account_note?: string | null
          custom_forum?: string | null
          custom_governing_law?: string | null
          custom_reserved_rights_caveat?: string | null
          custom_residuals_body?: string | null
          custom_withholding_note?: string | null
          deferred_payroll_usd?: number
          distribution_fee_pct?: number
          entry_id?: string | null
          foreign_sales_commission_pct?: number
          hurdle_multiple?: number
          id?: string
          investor_capital_usd?: number
          is_enabled?: boolean
          jurisdiction?: string
          notes?: string | null
          overhead_cap_usd?: number
          owner_id: string
          pa_cap_usd?: number
          parity_day_rate_usd?: number
          pool_contributor_pct?: number
          pool_creator_ip_pct?: number
          pool_investor_tail_pct?: number
          reserved_rights?: Json
          residuals_pct?: number
          sag_tier_note?: string | null
          universe_id?: string | null
          updated_at?: string
        }
        Update: {
          cam_fee_pct?: number
          created_at?: string
          cross_collateralize?: boolean
          custom_collection_account_note?: string | null
          custom_forum?: string | null
          custom_governing_law?: string | null
          custom_reserved_rights_caveat?: string | null
          custom_residuals_body?: string | null
          custom_withholding_note?: string | null
          deferred_payroll_usd?: number
          distribution_fee_pct?: number
          entry_id?: string | null
          foreign_sales_commission_pct?: number
          hurdle_multiple?: number
          id?: string
          investor_capital_usd?: number
          is_enabled?: boolean
          jurisdiction?: string
          notes?: string | null
          overhead_cap_usd?: number
          owner_id?: string
          pa_cap_usd?: number
          parity_day_rate_usd?: number
          pool_contributor_pct?: number
          pool_creator_ip_pct?: number
          pool_investor_tail_pct?: number
          reserved_rights?: Json
          residuals_pct?: number
          sag_tier_note?: string | null
          universe_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parity_deals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parity_deals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "parity_deals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parity_deals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parity_deals_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "project_universes"
            referencedColumns: ["id"]
          },
        ]
      }
      parity_participants: {
        Row: {
          collaborator_id: string | null
          created_at: string
          deal_id: string
          display_name_override: string | null
          id: string
          role_tier: Database["public"]["Enums"]["parity_role_tier"]
          unit_weight: number
          updated_at: string
        }
        Insert: {
          collaborator_id?: string | null
          created_at?: string
          deal_id: string
          display_name_override?: string | null
          id?: string
          role_tier?: Database["public"]["Enums"]["parity_role_tier"]
          unit_weight?: number
          updated_at?: string
        }
        Update: {
          collaborator_id?: string | null
          created_at?: string
          deal_id?: string
          display_name_override?: string | null
          id?: string
          role_tier?: Database["public"]["Enums"]["parity_role_tier"]
          unit_weight?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parity_participants_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "project_collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parity_participants_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "parity_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      parity_scenarios: {
        Row: {
          computed_waterfall: Json
          created_at: string
          created_by: string | null
          deal_id: string
          gross_receipts_usd: number
          id: string
          label: string
          updated_at: string
        }
        Insert: {
          computed_waterfall?: Json
          created_at?: string
          created_by?: string | null
          deal_id: string
          gross_receipts_usd?: number
          id?: string
          label: string
          updated_at?: string
        }
        Update: {
          computed_waterfall?: Json
          created_at?: string
          created_by?: string | null
          deal_id?: string
          gross_receipts_usd?: number
          id?: string
          label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parity_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "parity_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      parse_jobs: {
        Row: {
          bonus_already_claimed: boolean | null
          created_at: string
          error_message: string | null
          extracted_author: string | null
          extracted_genre: string | null
          extracted_title: string | null
          fountain_text: string | null
          id: string
          length_category: string | null
          new_balance: number | null
          over_limit: boolean | null
          page_count: number | null
          parse_warning: string | null
          status: string
          text_preview: string | null
          tokens_awarded: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bonus_already_claimed?: boolean | null
          created_at?: string
          error_message?: string | null
          extracted_author?: string | null
          extracted_genre?: string | null
          extracted_title?: string | null
          fountain_text?: string | null
          id?: string
          length_category?: string | null
          new_balance?: number | null
          over_limit?: boolean | null
          page_count?: number | null
          parse_warning?: string | null
          status?: string
          text_preview?: string | null
          tokens_awarded?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bonus_already_claimed?: boolean | null
          created_at?: string
          error_message?: string | null
          extracted_author?: string | null
          extracted_genre?: string | null
          extracted_title?: string | null
          fountain_text?: string | null
          id?: string
          length_category?: string | null
          new_balance?: number | null
          over_limit?: boolean | null
          page_count?: number | null
          parse_warning?: string | null
          status?: string
          text_preview?: string | null
          tokens_awarded?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string | null
          id: string
          invited_by: string | null
          pending_badges: Json
          status: string
          tier: Database["public"]["Enums"]["access_tier"]
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          pending_badges?: Json
          status?: string
          tier: Database["public"]["Enums"]["access_tier"]
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          pending_badges?: Json
          status?: string
          tier?: Database["public"]["Enums"]["access_tier"]
        }
        Relationships: []
      }
      pipeline_concept_attempts: {
        Row: {
          artifact_id: string | null
          artifact_version: number | null
          attempt_no: number
          concept: Json
          created_at: string
          file_id: string | null
          id: string
          project_id: string
          reasons: Json | null
          stage: string | null
          user_id: string
          verdict: string | null
        }
        Insert: {
          artifact_id?: string | null
          artifact_version?: number | null
          attempt_no?: number
          concept: Json
          created_at?: string
          file_id?: string | null
          id?: string
          project_id: string
          reasons?: Json | null
          stage?: string | null
          user_id: string
          verdict?: string | null
        }
        Update: {
          artifact_id?: string | null
          artifact_version?: number | null
          attempt_no?: number
          concept?: Json
          created_at?: string
          file_id?: string | null
          id?: string
          project_id?: string
          reasons?: Json | null
          stage?: string | null
          user_id?: string
          verdict?: string | null
        }
        Relationships: []
      }
      pipeline_flow_state: {
        Row: {
          created_at: string
          drafts: Json
          flow_key: string
          gate_results: Json
          id: string
          project_id: string
          selected_ids: Json
          step_idx: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          drafts?: Json
          flow_key?: string
          gate_results?: Json
          id?: string
          project_id: string
          selected_ids?: Json
          step_idx?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          drafts?: Json
          flow_key?: string
          gate_results?: Json
          id?: string
          project_id?: string
          selected_ids?: Json
          step_idx?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pitch_packages: {
        Row: {
          character_summaries: string
          comparable_references: string
          created_at: string
          entry_id: string
          id: string
          logline: string
          synopsis: string
          thematic_summary: string
          tone_description: string
          updated_at: string
          user_id: string
          world_description: string
        }
        Insert: {
          character_summaries?: string
          comparable_references?: string
          created_at?: string
          entry_id: string
          id?: string
          logline?: string
          synopsis?: string
          thematic_summary?: string
          tone_description?: string
          updated_at?: string
          user_id: string
          world_description?: string
        }
        Update: {
          character_summaries?: string
          comparable_references?: string
          created_at?: string
          entry_id?: string
          id?: string
          logline?: string
          synopsis?: string
          thematic_summary?: string
          tone_description?: string
          updated_at?: string
          user_id?: string
          world_description?: string
        }
        Relationships: [
          {
            foreignKeyName: "pitch_packages_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitch_packages_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "pitch_packages_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitch_packages_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_configs: {
        Row: {
          discount_percent: number
          monthly_tokens: number
          name: string
          price_cents_monthly: number
          price_label: string
          support: string
          tier: string
          updated_at: string
        }
        Insert: {
          discount_percent?: number
          monthly_tokens?: number
          name: string
          price_cents_monthly?: number
          price_label?: string
          support?: string
          tier: string
          updated_at?: string
        }
        Update: {
          discount_percent?: number
          monthly_tokens?: number
          name?: string
          price_cents_monthly?: number
          price_label?: string
          support?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      prize_pools: {
        Row: {
          awarded: boolean
          awarded_at: string | null
          competition_id: string
          contribution_pct: number
          created_at: string
          distribution_mode: string
          distribution_splits: Json
          id: string
          total_tokens: number
          updated_at: string
        }
        Insert: {
          awarded?: boolean
          awarded_at?: string | null
          competition_id: string
          contribution_pct?: number
          created_at?: string
          distribution_mode?: string
          distribution_splits?: Json
          id?: string
          total_tokens?: number
          updated_at?: string
        }
        Update: {
          awarded?: boolean
          awarded_at?: string | null
          competition_id?: string
          contribution_pct?: number
          created_at?: string
          distribution_mode?: string
          distribution_splits?: Json
          id?: string
          total_tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prize_pools_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: true
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          pen_name: string | null
          referral_code: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          pen_name?: string | null
          referral_code?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          pen_name?: string | null
          referral_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      proforma_change_log: {
        Row: {
          created_at: string
          document_id: string
          field_path: string
          id: string
          new_value: number | null
          old_value: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          field_path: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          field_path?: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proforma_change_log_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "business_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      project_artifacts: {
        Row: {
          artifact_type: Database["public"]["Enums"]["project_artifact_type"]
          created_at: string
          created_by: string | null
          id: string
          is_current: boolean
          legacy_id: string | null
          legacy_table:
            | Database["public"]["Enums"]["project_legacy_source"]
            | null
          payload_json: Json | null
          project_id: string
          storage_path: string | null
          updated_at: string
          version: number
        }
        Insert: {
          artifact_type: Database["public"]["Enums"]["project_artifact_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_current?: boolean
          legacy_id?: string | null
          legacy_table?:
            | Database["public"]["Enums"]["project_legacy_source"]
            | null
          payload_json?: Json | null
          project_id: string
          storage_path?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          artifact_type?: Database["public"]["Enums"]["project_artifact_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_current?: boolean
          legacy_id?: string | null
          legacy_table?:
            | Database["public"]["Enums"]["project_legacy_source"]
            | null
          payload_json?: Json | null
          project_id?: string
          storage_path?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_evidence_observation_requests: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          observation_id: string
          project_id: string
          recorded_by: string
          recording_base_hash: string
          request_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          observation_id: string
          project_id: string
          recorded_by: string
          recording_base_hash: string
          request_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          observation_id?: string
          project_id?: string
          recorded_by?: string
          recording_base_hash?: string
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_evidence_request_observation_project_fk"
            columns: [
              "observation_id",
              "project_id",
              "recorded_by",
              "recording_base_hash",
            ]
            isOneToOne: false
            referencedRelation: "project_evidence_observations"
            referencedColumns: [
              "id",
              "project_id",
              "recorded_by",
              "recording_base_hash",
            ]
          },
          {
            foreignKeyName: "project_evidence_observation_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_evidence_observations: {
        Row: {
          context_bundle_id: string
          context_payload_hash: string
          created_at: string
          entry_id: string
          envelope_json: Json
          envelope_sha256: string
          id: string
          local_authority_state: string
          local_byte_length: number
          local_exact_bytes: string
          local_schema_version: string
          local_sha256: string
          observation_state: string
          project_id: string
          record_kind: string
          recorded_by: string
          recording_base_hash: string
        }
        Insert: {
          context_bundle_id: string
          context_payload_hash: string
          created_at?: string
          entry_id: string
          envelope_json: Json
          envelope_sha256: string
          id?: string
          local_authority_state?: string
          local_byte_length: number
          local_exact_bytes: string
          local_schema_version: string
          local_sha256: string
          observation_state?: string
          project_id: string
          record_kind: string
          recorded_by: string
          recording_base_hash: string
        }
        Update: {
          context_bundle_id?: string
          context_payload_hash?: string
          created_at?: string
          entry_id?: string
          envelope_json?: Json
          envelope_sha256?: string
          id?: string
          local_authority_state?: string
          local_byte_length?: number
          local_exact_bytes?: string
          local_schema_version?: string
          local_sha256?: string
          observation_state?: string
          project_id?: string
          record_kind?: string
          recorded_by?: string
          recording_base_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_evidence_observations_context_bundle_id_fkey"
            columns: ["context_bundle_id"]
            isOneToOne: false
            referencedRelation: "context_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_evidence_observations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_evidence_observations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_brief_versions: {
        Row: {
          brief_id: string
          confidence: number | null
          created_at: string
          format_suggestion: string | null
          id: string
          organized: Json
          raw_dump: string
          source: string
          title: string | null
          user_id: string
        }
        Insert: {
          brief_id: string
          confidence?: number | null
          created_at?: string
          format_suggestion?: string | null
          id?: string
          organized?: Json
          raw_dump?: string
          source?: string
          title?: string | null
          user_id: string
        }
        Update: {
          brief_id?: string
          confidence?: number | null
          created_at?: string
          format_suggestion?: string | null
          id?: string
          organized?: Json
          raw_dump?: string
          source?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_brief_versions_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      project_briefs: {
        Row: {
          confidence: number | null
          created_at: string
          entry_id: string | null
          format_suggestion: string | null
          id: string
          organized: Json
          outline: Json | null
          raw_dump: string
          share_expires_at: string | null
          share_password_hash: string | null
          share_token: string | null
          title: string | null
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          entry_id?: string | null
          format_suggestion?: string | null
          id?: string
          organized?: Json
          outline?: Json | null
          raw_dump: string
          share_expires_at?: string | null
          share_password_hash?: string | null
          share_token?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          entry_id?: string | null
          format_suggestion?: string | null
          id?: string
          organized?: Json
          outline?: Json | null
          raw_dump?: string
          share_expires_at?: string | null
          share_password_hash?: string | null
          share_token?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_briefs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_briefs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "project_briefs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_briefs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      project_collaborators: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["collab_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["collab_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["collab_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_collaborators_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_collaborators_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "project_collaborators_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_collaborators_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      project_legacy_map: {
        Row: {
          created_at: string
          project_id: string
          source_id: string
          source_table: Database["public"]["Enums"]["project_legacy_source"]
        }
        Insert: {
          created_at?: string
          project_id: string
          source_id: string
          source_table: Database["public"]["Enums"]["project_legacy_source"]
        }
        Update: {
          created_at?: string
          project_id?: string
          source_id?: string
          source_table?: Database["public"]["Enums"]["project_legacy_source"]
        }
        Relationships: [
          {
            foreignKeyName: "project_legacy_map_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_lifecycle_events: {
        Row: {
          actor_id: string | null
          created_at: string
          evidence_hash: string | null
          from_state:
            | Database["public"]["Enums"]["project_lifecycle_state"]
            | null
          id: string
          project_id: string
          reason: string | null
          to_state: Database["public"]["Enums"]["project_lifecycle_state"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          evidence_hash?: string | null
          from_state?:
            | Database["public"]["Enums"]["project_lifecycle_state"]
            | null
          id?: string
          project_id: string
          reason?: string | null
          to_state: Database["public"]["Enums"]["project_lifecycle_state"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          evidence_hash?: string | null
          from_state?:
            | Database["public"]["Enums"]["project_lifecycle_state"]
            | null
          id?: string
          project_id?: string
          reason?: string | null
          to_state?: Database["public"]["Enums"]["project_lifecycle_state"]
        }
        Relationships: [
          {
            foreignKeyName: "project_lifecycle_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_memory_edges: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          notes: string
          relationship: string
          source_ref: string
          source_type: string
          target_ref: string
          target_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          notes?: string
          relationship?: string
          source_ref: string
          source_type: string
          target_ref: string
          target_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          notes?: string
          relationship?: string
          source_ref?: string
          source_type?: string
          target_ref?: string
          target_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_memory_edges_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_memory_edges_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "project_memory_edges_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_memory_edges_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stage_history: {
        Row: {
          changed_by: string
          created_at: string
          entry_id: string
          from_stage: Database["public"]["Enums"]["dev_stage"] | null
          id: string
          note: string | null
          to_stage: Database["public"]["Enums"]["dev_stage"]
        }
        Insert: {
          changed_by: string
          created_at?: string
          entry_id: string
          from_stage?: Database["public"]["Enums"]["dev_stage"] | null
          id?: string
          note?: string | null
          to_stage: Database["public"]["Enums"]["dev_stage"]
        }
        Update: {
          changed_by?: string
          created_at?: string
          entry_id?: string
          from_stage?: Database["public"]["Enums"]["dev_stage"] | null
          id?: string
          note?: string | null
          to_stage?: Database["public"]["Enums"]["dev_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "project_stage_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stage_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "project_stage_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stage_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      project_universes: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          competition_id: string | null
          created_at: string
          current_artifact_id: string | null
          id: string
          kind: Database["public"]["Enums"]["project_kind"]
          lifecycle_state: Database["public"]["Enums"]["project_lifecycle_state"]
          locked_elements: Json
          mode_preference: string
          owner_id: string
          title: string
          tradition_id: string | null
          universe_id: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          competition_id?: string | null
          created_at?: string
          current_artifact_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["project_kind"]
          lifecycle_state?: Database["public"]["Enums"]["project_lifecycle_state"]
          locked_elements?: Json
          mode_preference?: string
          owner_id: string
          title: string
          tradition_id?: string | null
          universe_id?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          competition_id?: string | null
          created_at?: string
          current_artifact_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["project_kind"]
          lifecycle_state?: Database["public"]["Enums"]["project_lifecycle_state"]
          locked_elements?: Json
          mode_preference?: string
          owner_id?: string
          title?: string
          tradition_id?: string | null
          universe_id?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: []
      }
      protected_authors: {
        Row: {
          active: boolean
          category: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          name_normalized: string
          notes: string | null
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          name_normalized: string
          notes?: string | null
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          name_normalized?: string
          notes?: string | null
        }
        Relationships: []
      }
      protected_style_clusters: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          label: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          label: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          label?: string
        }
        Relationships: []
      }
      provenance_edges: {
        Row: {
          created_at: string
          edge_type: string
          entry_id: string
          from_node_id: string
          id: string
          metadata_json: Json
          to_node_id: string
        }
        Insert: {
          created_at?: string
          edge_type: string
          entry_id: string
          from_node_id: string
          id?: string
          metadata_json?: Json
          to_node_id: string
        }
        Update: {
          created_at?: string
          edge_type?: string
          entry_id?: string
          from_node_id?: string
          id?: string
          metadata_json?: Json
          to_node_id?: string
        }
        Relationships: []
      }
      provenance_nodes: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          label: string
          metadata_json: Json
          node_type: string
          related_event_id: string | null
          related_version_id: string | null
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          label: string
          metadata_json?: Json
          node_type: string
          related_event_id?: string | null
          related_version_id?: string | null
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          label?: string
          metadata_json?: Json
          node_type?: string
          related_event_id?: string | null
          related_version_id?: string | null
        }
        Relationships: []
      }
      publication_claims: {
        Row: {
          claim_kind: string
          claim_text: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string
          evidence_note: string | null
          evidence_url: string | null
          id: string
          record_id: string
          record_version: number
          surface: string
          updated_at: string
        }
        Insert: {
          claim_kind: string
          claim_text: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          evidence_note?: string | null
          evidence_url?: string | null
          id?: string
          record_id: string
          record_version?: number
          surface: string
          updated_at?: string
        }
        Update: {
          claim_kind?: string
          claim_text?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          evidence_note?: string | null
          evidence_url?: string | null
          id?: string
          record_id?: string
          record_version?: number
          surface?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          bundle_name: string
          created_at: string
          id: string
          price_cents: number
          status: string
          stripe_session_id: string | null
          token_amount: number
          user_id: string
        }
        Insert: {
          bundle_name: string
          created_at?: string
          id?: string
          price_cents: number
          status?: string
          stripe_session_id?: string | null
          token_amount: number
          user_id: string
        }
        Update: {
          bundle_name?: string
          created_at?: string
          id?: string
          price_cents?: number
          status?: string
          stripe_session_id?: string | null
          token_amount?: number
          user_id?: string
        }
        Relationships: []
      }
      qframe_assets: {
        Row: {
          ai_tags: Json
          byte_size: number | null
          color_notes: string[]
          created_at: string
          filename: string | null
          id: string
          kind: string
          mime: string | null
          mood: string[]
          project_id: string
          quality_score: number | null
          role: string | null
          storage_path: string
          subject: string | null
          tagged_at: string | null
          updated_at: string
          usable_for: string[]
        }
        Insert: {
          ai_tags?: Json
          byte_size?: number | null
          color_notes?: string[]
          created_at?: string
          filename?: string | null
          id?: string
          kind: string
          mime?: string | null
          mood?: string[]
          project_id: string
          quality_score?: number | null
          role?: string | null
          storage_path: string
          subject?: string | null
          tagged_at?: string | null
          updated_at?: string
          usable_for?: string[]
        }
        Update: {
          ai_tags?: Json
          byte_size?: number | null
          color_notes?: string[]
          created_at?: string
          filename?: string | null
          id?: string
          kind?: string
          mime?: string | null
          mood?: string[]
          project_id?: string
          quality_score?: number | null
          role?: string | null
          storage_path?: string
          subject?: string | null
          tagged_at?: string | null
          updated_at?: string
          usable_for?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "qframe_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "qframe_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      qframe_characters: {
        Row: {
          costume: string | null
          created_at: string
          expression_sheet_asset_id: string | null
          forbidden_changes: string[]
          id: string
          name: string
          notes: string | null
          pose_sheet_asset_id: string | null
          project_id: string
          reference_slots: Json
          sprite_sheet_asset_id: string | null
          updated_at: string
        }
        Insert: {
          costume?: string | null
          created_at?: string
          expression_sheet_asset_id?: string | null
          forbidden_changes?: string[]
          id?: string
          name: string
          notes?: string | null
          pose_sheet_asset_id?: string | null
          project_id: string
          reference_slots?: Json
          sprite_sheet_asset_id?: string | null
          updated_at?: string
        }
        Update: {
          costume?: string | null
          created_at?: string
          expression_sheet_asset_id?: string | null
          forbidden_changes?: string[]
          id?: string
          name?: string
          notes?: string | null
          pose_sheet_asset_id?: string | null
          project_id?: string
          reference_slots?: Json
          sprite_sheet_asset_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qframe_characters_expression_sheet_asset_id_fkey"
            columns: ["expression_sheet_asset_id"]
            isOneToOne: false
            referencedRelation: "qframe_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qframe_characters_pose_sheet_asset_id_fkey"
            columns: ["pose_sheet_asset_id"]
            isOneToOne: false
            referencedRelation: "qframe_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qframe_characters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "qframe_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qframe_characters_sprite_sheet_asset_id_fkey"
            columns: ["sprite_sheet_asset_id"]
            isOneToOne: false
            referencedRelation: "qframe_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      qframe_music_sections: {
        Row: {
          created_at: string
          emotion: string | null
          end_sec: number
          energy: number | null
          id: string
          lyric_excerpt: string | null
          name: string
          ordinal: number
          project_id: string
          start_sec: number
          updated_at: string
          visual_mode: string | null
        }
        Insert: {
          created_at?: string
          emotion?: string | null
          end_sec: number
          energy?: number | null
          id?: string
          lyric_excerpt?: string | null
          name: string
          ordinal?: number
          project_id: string
          start_sec: number
          updated_at?: string
          visual_mode?: string | null
        }
        Update: {
          created_at?: string
          emotion?: string | null
          end_sec?: number
          energy?: number | null
          id?: string
          lyric_excerpt?: string | null
          name?: string
          ordinal?: number
          project_id?: string
          start_sec?: number
          updated_at?: string
          visual_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qframe_music_sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "qframe_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      qframe_projects: {
        Row: {
          bpm: number | null
          created_at: string
          duration_sec: number | null
          id: string
          owner_id: string
          song_artist: string | null
          song_title: string | null
          status: string
          story_summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          bpm?: number | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          owner_id: string
          song_artist?: string | null
          song_title?: string | null
          status?: string
          story_summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          bpm?: number | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          owner_id?: string
          song_artist?: string | null
          song_title?: string | null
          status?: string
          story_summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      qframe_q_scores: {
        Row: {
          decision: string | null
          id: string
          notes: string | null
          q_identity: number | null
          q_motion: number | null
          q_music: number | null
          q_perspective: number | null
          q_story: number | null
          q_style: number | null
          scored_at: string
          scored_by: string
          shot_id: string
          total: number | null
        }
        Insert: {
          decision?: string | null
          id?: string
          notes?: string | null
          q_identity?: number | null
          q_motion?: number | null
          q_music?: number | null
          q_perspective?: number | null
          q_story?: number | null
          q_style?: number | null
          scored_at?: string
          scored_by: string
          shot_id: string
          total?: number | null
        }
        Update: {
          decision?: string | null
          id?: string
          notes?: string | null
          q_identity?: number | null
          q_motion?: number | null
          q_music?: number | null
          q_perspective?: number | null
          q_story?: number | null
          q_style?: number | null
          scored_at?: string
          scored_by?: string
          shot_id?: string
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "qframe_q_scores_shot_id_fkey"
            columns: ["shot_id"]
            isOneToOne: false
            referencedRelation: "qframe_shots"
            referencedColumns: ["id"]
          },
        ]
      }
      qframe_shot_refs: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          role: string | null
          shot_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          role?: string | null
          shot_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          role?: string | null
          shot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qframe_shot_refs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "qframe_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qframe_shot_refs_shot_id_fkey"
            columns: ["shot_id"]
            isOneToOne: false
            referencedRelation: "qframe_shots"
            referencedColumns: ["id"]
          },
        ]
      }
      qframe_shots: {
        Row: {
          camera: Json
          continuity_rules: string[]
          created_at: string
          evidence_hash: string | null
          id: string
          lint_warnings: Json
          motion_prompt: string | null
          narrative_function: string | null
          negative_prompt: string | null
          ordinal: number
          perspective_mode: string | null
          project_id: string
          section_id: string | null
          status: string
          time_end_sec: number | null
          time_start_sec: number | null
          updated_at: string
          visual_prompt: string | null
        }
        Insert: {
          camera?: Json
          continuity_rules?: string[]
          created_at?: string
          evidence_hash?: string | null
          id?: string
          lint_warnings?: Json
          motion_prompt?: string | null
          narrative_function?: string | null
          negative_prompt?: string | null
          ordinal?: number
          perspective_mode?: string | null
          project_id: string
          section_id?: string | null
          status?: string
          time_end_sec?: number | null
          time_start_sec?: number | null
          updated_at?: string
          visual_prompt?: string | null
        }
        Update: {
          camera?: Json
          continuity_rules?: string[]
          created_at?: string
          evidence_hash?: string | null
          id?: string
          lint_warnings?: Json
          motion_prompt?: string | null
          narrative_function?: string | null
          negative_prompt?: string | null
          ordinal?: number
          perspective_mode?: string | null
          project_id?: string
          section_id?: string | null
          status?: string
          time_end_sec?: number | null
          time_start_sec?: number | null
          updated_at?: string
          visual_prompt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qframe_shots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "qframe_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qframe_shots_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "qframe_music_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      qframe_symbols: {
        Row: {
          created_at: string
          evolution: string[]
          id: string
          meaning: string | null
          must_appear_in: string[]
          project_id: string
          symbol: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          evolution?: string[]
          id?: string
          meaning?: string | null
          must_appear_in?: string[]
          project_id: string
          symbol: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          evolution?: string[]
          id?: string
          meaning?: string | null
          must_appear_in?: string[]
          project_id?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qframe_symbols_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "qframe_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      qframe_visual_bible: {
        Row: {
          color_arc: Json
          core_theme: string | null
          created_at: string
          notes: string | null
          perspective_arc: Json
          project_id: string
          updated_at: string
          visual_question: string | null
        }
        Insert: {
          color_arc?: Json
          core_theme?: string | null
          created_at?: string
          notes?: string | null
          perspective_arc?: Json
          project_id: string
          updated_at?: string
          visual_question?: string | null
        }
        Update: {
          color_arc?: Json
          core_theme?: string | null
          created_at?: string
          notes?: string | null
          perspective_arc?: Json
          project_id?: string
          updated_at?: string
          visual_question?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qframe_visual_bible_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "qframe_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_vectors: {
        Row: {
          axis: string
          confidence: number
          context_bundle_id: string | null
          context_hash: string | null
          created_at: string
          evaluator_model: string
          id: string
          project_id: string
          rationale: string
          score: number
          shadow: boolean
        }
        Insert: {
          axis: string
          confidence: number
          context_bundle_id?: string | null
          context_hash?: string | null
          created_at?: string
          evaluator_model: string
          id?: string
          project_id: string
          rationale: string
          score: number
          shadow?: boolean
        }
        Update: {
          axis?: string
          confidence?: number
          context_bundle_id?: string | null
          context_hash?: string | null
          created_at?: string
          evaluator_model?: string
          id?: string
          project_id?: string
          rationale?: string
          score?: number
          shadow?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "quality_vectors_context_bundle_id_fkey"
            columns: ["context_bundle_id"]
            isOneToOne: false
            referencedRelation: "context_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_vectors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      query_evidence_log: {
        Row: {
          committed: boolean
          context_hash: string | null
          context_id: string | null
          context_kind: string
          created_at: string
          evidence_hash: string
          function_name: string
          id: string
          media_type: string | null
          principal_id: string | null
          query_hash: string
          response_bytes: number | null
          response_media_type: string | null
          state_hash: string | null
        }
        Insert: {
          committed?: boolean
          context_hash?: string | null
          context_id?: string | null
          context_kind?: string
          created_at?: string
          evidence_hash: string
          function_name: string
          id?: string
          media_type?: string | null
          principal_id?: string | null
          query_hash: string
          response_bytes?: number | null
          response_media_type?: string | null
          state_hash?: string | null
        }
        Update: {
          committed?: boolean
          context_hash?: string | null
          context_id?: string | null
          context_kind?: string
          created_at?: string
          evidence_hash?: string
          function_name?: string
          id?: string
          media_type?: string | null
          principal_id?: string | null
          query_hash?: string
          response_bytes?: number | null
          response_media_type?: string | null
          state_hash?: string | null
        }
        Relationships: []
      }
      reader_badges: {
        Row: {
          awarded_at: string
          badge_key: string
          id: string
          meta: Json
          user_id: string
        }
        Insert: {
          awarded_at?: string
          badge_key: string
          id?: string
          meta?: Json
          user_id: string
        }
        Update: {
          awarded_at?: string
          badge_key?: string
          id?: string
          meta?: Json
          user_id?: string
        }
        Relationships: []
      }
      reader_chapter_members: {
        Row: {
          chapter_id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          chapter_id: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          chapter_id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reader_chapter_members_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "reader_chapters"
            referencedColumns: ["id"]
          },
        ]
      }
      reader_chapters: {
        Row: {
          color: string | null
          created_at: string
          creator_id: string
          description: string | null
          id: string
          is_public: boolean
          member_count: number
          name: string
          token_config: Json
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          creator_id: string
          description?: string | null
          id?: string
          is_public?: boolean
          member_count?: number
          name: string
          token_config?: Json
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          creator_id?: string
          description?: string | null
          id?: string
          is_public?: boolean
          member_count?: number
          name?: string
          token_config?: Json
          updated_at?: string
        }
        Relationships: []
      }
      reading_cycle_memberships: {
        Row: {
          completed_at: string | null
          cycle_id: string
          joined_at: string
          page_time_map: Json
          pages_read: number
          progress_pct: number
          read_minutes: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          cycle_id: string
          joined_at?: string
          page_time_map?: Json
          pages_read?: number
          progress_pct?: number
          read_minutes?: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          cycle_id?: string
          joined_at?: string
          page_time_map?: Json
          pages_read?: number
          progress_pct?: number
          read_minutes?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_cycle_memberships_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "reading_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_cycles: {
        Row: {
          chapter_id: string | null
          created_at: string
          created_by: string | null
          end_date: string
          entry_id: string | null
          id: string
          screenplay_author: string | null
          screenplay_genre: string | null
          screenplay_title: string
          start_date: string
          status: string
          tier: string
          total_pages: number
          updated_at: string
        }
        Insert: {
          chapter_id?: string | null
          created_at?: string
          created_by?: string | null
          end_date: string
          entry_id?: string | null
          id?: string
          screenplay_author?: string | null
          screenplay_genre?: string | null
          screenplay_title: string
          start_date?: string
          status?: string
          tier: string
          total_pages: number
          updated_at?: string
        }
        Update: {
          chapter_id?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string
          entry_id?: string | null
          id?: string
          screenplay_author?: string | null
          screenplay_genre?: string | null
          screenplay_title?: string
          start_date?: string
          status?: string
          tier?: string
          total_pages?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_cycles_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "reader_chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_cycles_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_cycles_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "reading_cycles_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_cycles_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_history: {
        Row: {
          cycle_id: string | null
          entry_id: string | null
          finished_at: string | null
          genre: string | null
          id: string
          pages_read: number
          read_minutes: number
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cycle_id?: string | null
          entry_id?: string | null
          finished_at?: string | null
          genre?: string | null
          id?: string
          pages_read?: number
          read_minutes?: number
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cycle_id?: string | null
          entry_id?: string | null
          finished_at?: string | null
          genre?: string | null
          id?: string
          pages_read?: number
          read_minutes?: number
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_history_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "reading_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "reading_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referral_code: string
          referred_id: string
          referrer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          referral_code: string
          referred_id: string
          referrer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          referral_code?: string
          referred_id?: string
          referrer_id?: string
        }
        Relationships: []
      }
      review_disputes: {
        Row: {
          admin_note: string | null
          created_at: string
          id: string
          reason: string
          resolved_at: string | null
          review_id: string
          status: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: string
          reason: string
          resolved_at?: string | null
          review_id: string
          status?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: string
          reason?: string
          resolved_at?: string | null
          review_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_disputes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "club_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_requests: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          message: string
          requested_by: string
          reviewer_id: string
          reviewer_type: string
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          version_id: string | null
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          message?: string
          requested_by: string
          reviewer_id: string
          reviewer_type?: string
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
          version_id?: string | null
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          message?: string
          requested_by?: string
          reviewer_id?: string
          reviewer_type?: string
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_requests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "review_requests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "screenplay_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      rewrite_suggestions: {
        Row: {
          created_at: string | null
          element_text: string
          entry_id: string
          id: string
          priority: string
          reason: string
          suggested_action: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          element_text: string
          entry_id: string
          id?: string
          priority: string
          reason: string
          suggested_action: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          element_text?: string
          entry_id?: string
          id?: string
          priority?: string
          reason?: string
          suggested_action?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      rubric_change_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          changes: Json
          from_version: number | null
          id: string
          label: string | null
          new_definition: Json
          preset_id: string
          prev_definition: Json | null
          to_version: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changes?: Json
          from_version?: number | null
          id?: string
          label?: string | null
          new_definition: Json
          preset_id: string
          prev_definition?: Json | null
          to_version: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changes?: Json
          from_version?: number | null
          id?: string
          label?: string | null
          new_definition?: Json
          preset_id?: string
          prev_definition?: Json | null
          to_version?: number
        }
        Relationships: []
      }
      rubric_versions: {
        Row: {
          created_at: string
          created_by: string | null
          definition: Json
          id: string
          label: string | null
          preset_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition: Json
          id?: string
          label?: string | null
          preset_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          id?: string
          label?: string | null
          preset_id?: string
          version?: number
        }
        Relationships: []
      }
      runway_milestones: {
        Row: {
          created_at: string
          estimated_cost: number
          id: string
          notes: string | null
          scope_id: string
          scope_type: Database["public"]["Enums"]["cash_burn_scope"]
          status: Database["public"]["Enums"]["runway_milestone_status"]
          target_date: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          estimated_cost?: number
          id?: string
          notes?: string | null
          scope_id: string
          scope_type: Database["public"]["Enums"]["cash_burn_scope"]
          status?: Database["public"]["Enums"]["runway_milestone_status"]
          target_date?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          estimated_cost?: number
          id?: string
          notes?: string | null
          scope_id?: string
          scope_type?: Database["public"]["Enums"]["cash_burn_scope"]
          status?: Database["public"]["Enums"]["runway_milestone_status"]
          target_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scores: {
        Row: {
          audience: number | null
          character_depth: number
          character_score: number | null
          created_at: string
          dialogue: number
          dimension_scores: Json
          emotion: number
          emotional: number | null
          entry_id: string
          feedback: string | null
          finalized_at: string | null
          finalized_by: string | null
          format_adherence: number
          franchise: number | null
          id: string
          judge_count: number | null
          judge_model_id: string | null
          market: number | null
          narrative: number | null
          originality: number
          production: number | null
          rubric_preset: string
          rubric_version: number | null
          structure: number
          supersede_reason: string | null
          superseded_at: string | null
          superseded_by: string | null
          theme: number
          total_score: number
          visual: number | null
        }
        Insert: {
          audience?: number | null
          character_depth: number
          character_score?: number | null
          created_at?: string
          dialogue: number
          dimension_scores?: Json
          emotion: number
          emotional?: number | null
          entry_id: string
          feedback?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          format_adherence: number
          franchise?: number | null
          id?: string
          judge_count?: number | null
          judge_model_id?: string | null
          market?: number | null
          narrative?: number | null
          originality: number
          production?: number | null
          rubric_preset?: string
          rubric_version?: number | null
          structure: number
          supersede_reason?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          theme: number
          total_score: number
          visual?: number | null
        }
        Update: {
          audience?: number | null
          character_depth?: number
          character_score?: number | null
          created_at?: string
          dialogue?: number
          dimension_scores?: Json
          emotion?: number
          emotional?: number | null
          entry_id?: string
          feedback?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          format_adherence?: number
          franchise?: number | null
          id?: string
          judge_count?: number | null
          judge_model_id?: string | null
          market?: number | null
          narrative?: number | null
          originality?: number
          production?: number | null
          rubric_preset?: string
          rubric_version?: number | null
          structure?: number
          supersede_reason?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          theme?: number
          total_score?: number
          visual?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scores_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "scores_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_audience_votes: {
        Row: {
          created_at: string
          id: string
          rating: number
          session_id: string
          user_id: string | null
          voter_fingerprint: string
        }
        Insert: {
          created_at?: string
          id?: string
          rating: number
          session_id: string
          user_id?: string | null
          voter_fingerprint: string
        }
        Update: {
          created_at?: string
          id?: string
          rating?: number
          session_id?: string
          user_id?: string | null
          voter_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_audience_votes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "screening_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_sessions: {
        Row: {
          competition_id: string
          created_at: string
          ended_at: string | null
          entry_id: string
          finalize_reason: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          scheduled_for: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["screening_status"]
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          ended_at?: string | null
          entry_id: string
          finalize_reason?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          scheduled_for?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["screening_status"]
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          ended_at?: string | null
          entry_id?: string
          finalize_reason?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          scheduled_for?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["screening_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_sessions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_sessions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_sessions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "screening_sessions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_sessions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      screenplay_draft_versions: {
        Row: {
          correlation_id: string | null
          created_at: string
          draft_id: string
          fountain_text: string
          id: string
          page_count: number
          parent_version_id: string | null
          source: string
          title: string | null
          trigger_action: string
          trigger_function: string | null
          trigger_metadata: Json
          user_id: string
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          draft_id: string
          fountain_text?: string
          id?: string
          page_count?: number
          parent_version_id?: string | null
          source?: string
          title?: string | null
          trigger_action?: string
          trigger_function?: string | null
          trigger_metadata?: Json
          user_id: string
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          draft_id?: string
          fountain_text?: string
          id?: string
          page_count?: number
          parent_version_id?: string | null
          source?: string
          title?: string | null
          trigger_action?: string
          trigger_function?: string | null
          trigger_metadata?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screenplay_draft_versions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "screenplay_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenplay_draft_versions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "v_screenplay_drafts_divergence"
            referencedColumns: ["draft_id"]
          },
          {
            foreignKeyName: "screenplay_draft_versions_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "screenplay_draft_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      screenplay_drafts: {
        Row: {
          brief_id: string | null
          created_at: string
          format: string | null
          fountain_text: string
          genre: string | null
          id: string
          last_edited_at: string
          page_count: number
          parsed_stats: Json | null
          scene_count: number
          source_entry_id: string | null
          target_page_count: number | null
          title: string
          total_words: number
          updated_at: string
          user_id: string
        }
        Insert: {
          brief_id?: string | null
          created_at?: string
          format?: string | null
          fountain_text?: string
          genre?: string | null
          id?: string
          last_edited_at?: string
          page_count?: number
          parsed_stats?: Json | null
          scene_count?: number
          source_entry_id?: string | null
          target_page_count?: number | null
          title?: string
          total_words?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          brief_id?: string | null
          created_at?: string
          format?: string | null
          fountain_text?: string
          genre?: string | null
          id?: string
          last_edited_at?: string
          page_count?: number
          parsed_stats?: Json | null
          scene_count?: number
          source_entry_id?: string | null
          target_page_count?: number | null
          title?: string
          total_words?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screenplay_drafts_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenplay_drafts_source_entry_id_fkey"
            columns: ["source_entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenplay_drafts_source_entry_id_fkey"
            columns: ["source_entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "screenplay_drafts_source_entry_id_fkey"
            columns: ["source_entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenplay_drafts_source_entry_id_fkey"
            columns: ["source_entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      screenplay_highlights: {
        Row: {
          color: string
          created_at: string
          element_index: number
          end_offset: number
          entry_id: string
          id: string
          note: string
          selected_text: string
          start_offset: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          element_index: number
          end_offset?: number
          entry_id: string
          id?: string
          note?: string
          selected_text?: string
          start_offset?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          element_index?: number
          end_offset?: number
          entry_id?: string
          id?: string
          note?: string
          selected_text?: string
          start_offset?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screenplay_highlights_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenplay_highlights_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "screenplay_highlights_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenplay_highlights_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      screenplay_versions: {
        Row: {
          actor_id: string | null
          actor_type: string
          created_at: string
          entry_id: string
          id: string
          parent_version_id: string | null
          source_type: string
          text_excerpt: string | null
          text_hash: string
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          created_at?: string
          entry_id: string
          id?: string
          parent_version_id?: string | null
          source_type: string
          text_excerpt?: string | null
          text_hash: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          entry_id?: string
          id?: string
          parent_version_id?: string | null
          source_type?: string
          text_excerpt?: string | null
          text_hash?: string
        }
        Relationships: []
      }
      script_quotients: {
        Row: {
          audience_q: number | null
          causal_pressure_q: number | null
          character_q: number | null
          confidence_score: number | null
          created_at: string
          creativity_q: number | null
          dialogue_q: number | null
          entry_id: string
          equilibrium_q: number | null
          id: string
          market_q: number | null
          meaning_density_q: number | null
          pattern_turn_q: number | null
          relational_meaning_q: number | null
          structure_q: number | null
          theme_q: number | null
          tradition_confidence: number | null
          tradition_detected: string | null
          variance_score: number | null
          want_need_gap_q: number | null
        }
        Insert: {
          audience_q?: number | null
          causal_pressure_q?: number | null
          character_q?: number | null
          confidence_score?: number | null
          created_at?: string
          creativity_q?: number | null
          dialogue_q?: number | null
          entry_id: string
          equilibrium_q?: number | null
          id?: string
          market_q?: number | null
          meaning_density_q?: number | null
          pattern_turn_q?: number | null
          relational_meaning_q?: number | null
          structure_q?: number | null
          theme_q?: number | null
          tradition_confidence?: number | null
          tradition_detected?: string | null
          variance_score?: number | null
          want_need_gap_q?: number | null
        }
        Update: {
          audience_q?: number | null
          causal_pressure_q?: number | null
          character_q?: number | null
          confidence_score?: number | null
          created_at?: string
          creativity_q?: number | null
          dialogue_q?: number | null
          entry_id?: string
          equilibrium_q?: number | null
          id?: string
          market_q?: number | null
          meaning_density_q?: number | null
          pattern_turn_q?: number | null
          relational_meaning_q?: number | null
          structure_q?: number | null
          theme_q?: number | null
          tradition_confidence?: number | null
          tradition_detected?: string | null
          variance_score?: number | null
          want_need_gap_q?: number | null
        }
        Relationships: []
      }
      seasons: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          slug: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      share_link_access_log: {
        Row: {
          access_type: Database["public"]["Enums"]["share_access_type"]
          accessed_at: string
          id: string
          share_link_id: string
          version_viewed: string | null
        }
        Insert: {
          access_type: Database["public"]["Enums"]["share_access_type"]
          accessed_at?: string
          id?: string
          share_link_id: string
          version_viewed?: string | null
        }
        Update: {
          access_type?: Database["public"]["Enums"]["share_access_type"]
          accessed_at?: string
          id?: string
          share_link_id?: string
          version_viewed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "share_link_access_log_share_link_id_fkey"
            columns: ["share_link_id"]
            isOneToOne: false
            referencedRelation: "share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      share_links: {
        Row: {
          access_type: Database["public"]["Enums"]["share_access_type"]
          created_at: string
          created_by: string
          entry_id: string
          expires_at: string | null
          id: string
          label: string
          max_views: number | null
          require_email: boolean
          revoked_at: string | null
          token: string
          view_count: number
          watermark_payload: Json | null
        }
        Insert: {
          access_type?: Database["public"]["Enums"]["share_access_type"]
          created_at?: string
          created_by: string
          entry_id: string
          expires_at?: string | null
          id?: string
          label?: string
          max_views?: number | null
          require_email?: boolean
          revoked_at?: string | null
          token?: string
          view_count?: number
          watermark_payload?: Json | null
        }
        Update: {
          access_type?: Database["public"]["Enums"]["share_access_type"]
          created_at?: string
          created_by?: string
          entry_id?: string
          expires_at?: string | null
          id?: string
          label?: string
          max_views?: number | null
          require_email?: boolean
          revoked_at?: string | null
          token?: string
          view_count?: number
          watermark_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "share_links_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "share_links_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      signalcheck_analyses: {
        Row: {
          created_at: string
          id: string
          mode: string
          model: string | null
          original_text: string
          revised_text: string | null
          scores: Json
          title: string | null
          tokens_spent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mode?: string
          model?: string | null
          original_text: string
          revised_text?: string | null
          scores?: Json
          title?: string | null
          tokens_spent?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string
          model?: string | null
          original_text?: string
          revised_text?: string | null
          scores?: Json
          title?: string | null
          tokens_spent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      signalcheck_claims: {
        Row: {
          action: string
          analysis_id: string
          claim_text: string
          claim_type: string
          created_at: string
          evidence_status: string
          id: string
          ordinal: number
          risk_level: string
          span_end: number | null
          span_start: number | null
          suggested_rewrite: string | null
        }
        Insert: {
          action?: string
          analysis_id: string
          claim_text: string
          claim_type: string
          created_at?: string
          evidence_status?: string
          id?: string
          ordinal?: number
          risk_level?: string
          span_end?: number | null
          span_start?: number | null
          suggested_rewrite?: string | null
        }
        Update: {
          action?: string
          analysis_id?: string
          claim_text?: string
          claim_type?: string
          created_at?: string
          evidence_status?: string
          id?: string
          ordinal?: number
          risk_level?: string
          span_end?: number | null
          span_start?: number | null
          suggested_rewrite?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signalcheck_claims_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "signalcheck_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      signalcheck_signals: {
        Row: {
          analysis_id: string
          color: string
          created_at: string
          explanation: string | null
          id: string
          phrase: string
          replacement_suggestion: string | null
          severity: string
          signal_type: string
          span_end: number | null
          span_start: number | null
        }
        Insert: {
          analysis_id: string
          color?: string
          created_at?: string
          explanation?: string | null
          id?: string
          phrase: string
          replacement_suggestion?: string | null
          severity?: string
          signal_type: string
          span_end?: number | null
          span_start?: number | null
        }
        Update: {
          analysis_id?: string
          color?: string
          created_at?: string
          explanation?: string | null
          id?: string
          phrase?: string
          replacement_suggestion?: string | null
          severity?: string
          signal_type?: string
          span_end?: number | null
          span_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "signalcheck_signals_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "signalcheck_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      site_analytics_snapshots: {
        Row: {
          bounce_rate: number
          countries: Json
          created_at: string
          daily_series: Json
          devices: Json
          id: string
          pageviews: number
          pageviews_per_visit: number
          period_end: string
          period_start: string
          session_duration_sec: number
          snapshot_date: string
          top_pages: Json
          traffic_sources: Json
          visitors: number
        }
        Insert: {
          bounce_rate?: number
          countries?: Json
          created_at?: string
          daily_series?: Json
          devices?: Json
          id?: string
          pageviews?: number
          pageviews_per_visit?: number
          period_end: string
          period_start: string
          session_duration_sec?: number
          snapshot_date?: string
          top_pages?: Json
          traffic_sources?: Json
          visitors?: number
        }
        Update: {
          bounce_rate?: number
          countries?: Json
          created_at?: string
          daily_series?: Json
          devices?: Json
          id?: string
          pageviews?: number
          pageviews_per_visit?: number
          period_end?: string
          period_start?: string
          session_duration_sec?: number
          snapshot_date?: string
          top_pages?: Json
          traffic_sources?: Json
          visitors?: number
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          key: string
          text_value: string | null
          updated_at: string
          value: boolean
        }
        Insert: {
          key: string
          text_value?: string | null
          updated_at?: string
          value?: boolean
        }
        Update: {
          key?: string
          text_value?: string | null
          updated_at?: string
          value?: boolean
        }
        Relationships: []
      }
      sponsorship_offers: {
        Row: {
          competition_id: string | null
          created_at: string
          festival_id: string | null
          id: string
          message: string
          offer_amount_cents: number
          offer_type: string
          status: string
          user_id: string
        }
        Insert: {
          competition_id?: string | null
          created_at?: string
          festival_id?: string | null
          id?: string
          message?: string
          offer_amount_cents?: number
          offer_type?: string
          status?: string
          user_id: string
        }
        Update: {
          competition_id?: string | null
          created_at?: string
          festival_id?: string | null
          id?: string
          message?: string
          offer_amount_cents?: number
          offer_type?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsorship_offers_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsorship_offers_festival_id_fkey"
            columns: ["festival_id"]
            isOneToOne: false
            referencedRelation: "festivals"
            referencedColumns: ["id"]
          },
        ]
      }
      story_world_elements: {
        Row: {
          created_at: string
          description: string
          element_type: string
          entry_id: string
          id: string
          metadata_json: Json
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          element_type?: string
          entry_id: string
          id?: string
          metadata_json?: Json
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          element_type?: string
          entry_id?: string
          id?: string
          metadata_json?: Json
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_world_elements_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_world_elements_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "story_world_elements_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_world_elements_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      story_world_links: {
        Row: {
          created_at: string
          element_id: string
          id: string
          notes: string
          target_ref: string
          target_type: string
        }
        Insert: {
          created_at?: string
          element_id: string
          id?: string
          notes?: string
          target_ref?: string
          target_type?: string
        }
        Update: {
          created_at?: string
          element_id?: string
          id?: string
          notes?: string
          target_ref?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_world_links_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "story_world_elements"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          created_at: string
          email: string | null
          stripe_customer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          stripe_customer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          stripe_customer_id?: string
          user_id?: string
        }
        Relationships: []
      }
      structured_reviews: {
        Row: {
          clarity_signals: string
          concerns: string
          created_at: string
          entry_id: string
          id: string
          narrative_observations: string
          overall_notes: string
          review_request_id: string | null
          reviewer_id: string
          strengths: string
          updated_at: string
          version_id: string | null
          visibility: Database["public"]["Enums"]["review_visibility"]
        }
        Insert: {
          clarity_signals?: string
          concerns?: string
          created_at?: string
          entry_id: string
          id?: string
          narrative_observations?: string
          overall_notes?: string
          review_request_id?: string | null
          reviewer_id: string
          strengths?: string
          updated_at?: string
          version_id?: string | null
          visibility?: Database["public"]["Enums"]["review_visibility"]
        }
        Update: {
          clarity_signals?: string
          concerns?: string
          created_at?: string
          entry_id?: string
          id?: string
          narrative_observations?: string
          overall_notes?: string
          review_request_id?: string | null
          reviewer_id?: string
          strengths?: string
          updated_at?: string
          version_id?: string | null
          visibility?: Database["public"]["Enums"]["review_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "structured_reviews_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structured_reviews_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "structured_reviews_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structured_reviews_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structured_reviews_review_request_id_fkey"
            columns: ["review_request_id"]
            isOneToOne: false
            referencedRelation: "review_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structured_reviews_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "screenplay_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_inquiries: {
        Row: {
          created_at: string
          email: string
          estimated_volume: string
          id: string
          name: string
          status: string
          use_case: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          estimated_volume?: string
          id?: string
          name: string
          status?: string
          use_case?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          estimated_volume?: string
          id?: string
          name?: string
          status?: string
          use_case?: string
          user_id?: string | null
        }
        Relationships: []
      }
      submission_attestations: {
        Row: {
          acknowledged_terms: boolean
          attestation_text: string
          created_at: string
          entry_id: string | null
          has_rights: boolean
          id: string
          ip_hash: string | null
          is_sole_author: boolean
          user_agent: string | null
          user_id: string
        }
        Insert: {
          acknowledged_terms: boolean
          attestation_text: string
          created_at?: string
          entry_id?: string | null
          has_rights: boolean
          id?: string
          ip_hash?: string | null
          is_sole_author: boolean
          user_agent?: string | null
          user_id: string
        }
        Update: {
          acknowledged_terms?: boolean
          attestation_text?: string
          created_at?: string
          entry_id?: string | null
          has_rights?: boolean
          id?: string
          ip_hash?: string | null
          is_sole_author?: boolean
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_attestations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_attestations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "submission_attestations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_attestations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_stylometrics: {
        Row: {
          ai_detector_score: number | null
          cliche_density: number | null
          computed_at: string
          entry_id: string | null
          extractor_version: string
          features: Json
          id: string
          lexical_diversity: number | null
          multi_signal_score: number | null
          screenplay_id: string | null
          sentence_length_variance: number | null
          user_id: string
          word_count: number | null
        }
        Insert: {
          ai_detector_score?: number | null
          cliche_density?: number | null
          computed_at?: string
          entry_id?: string | null
          extractor_version?: string
          features?: Json
          id?: string
          lexical_diversity?: number | null
          multi_signal_score?: number | null
          screenplay_id?: string | null
          sentence_length_variance?: number | null
          user_id: string
          word_count?: number | null
        }
        Update: {
          ai_detector_score?: number | null
          cliche_density?: number | null
          computed_at?: string
          entry_id?: string | null
          extractor_version?: string
          features?: Json
          id?: string
          lexical_diversity?: number | null
          multi_signal_score?: number | null
          screenplay_id?: string | null
          sentence_length_variance?: number | null
          user_id?: string
          word_count?: number | null
        }
        Relationships: []
      }
      subscription_changes: {
        Row: {
          changed_by: string
          created_at: string
          id: string
          new_plan: string
          old_plan: string
          user_id: string
        }
        Insert: {
          changed_by: string
          created_at?: string
          id?: string
          new_plan: string
          old_plan: string
          user_id: string
        }
        Update: {
          changed_by?: string
          created_at?: string
          id?: string
          new_plan?: string
          old_plan?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          monthly_tokens_remaining: number
          plan: Database["public"]["Enums"]["plan_tier"]
          status: string
          stripe_subscription_id: string | null
          subscriber_number: number | null
          uiq: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          monthly_tokens_remaining?: number
          plan?: Database["public"]["Enums"]["plan_tier"]
          status?: string
          stripe_subscription_id?: string | null
          subscriber_number?: number | null
          uiq?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          monthly_tokens_remaining?: number
          plan?: Database["public"]["Enums"]["plan_tier"]
          status?: string
          stripe_subscription_id?: string | null
          subscriber_number?: number | null
          uiq?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_audits: {
        Row: {
          audit_type: string
          changes: Json
          created_at: string
          id: string
          status: string
          summary: string
          system_snapshot: Json
          title: string
          user_id: string
        }
        Insert: {
          audit_type?: string
          changes?: Json
          created_at?: string
          id?: string
          status?: string
          summary?: string
          system_snapshot?: Json
          title: string
          user_id: string
        }
        Update: {
          audit_type?: string
          changes?: Json
          created_at?: string
          id?: string
          status?: string
          summary?: string
          system_snapshot?: Json
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      tester_activity_log: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json
          page_url: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json
          page_url?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json
          page_url?: string
          user_id?: string
        }
        Relationships: []
      }
      tester_feedback: {
        Row: {
          category: string
          created_at: string
          id: string
          message: string
          page_url: string
          screenshot_url: string | null
          status: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          message: string
          page_url?: string
          screenshot_url?: string | null
          status?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          message?: string
          page_url?: string
          screenshot_url?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      title_logline_history: {
        Row: {
          created_at: string | null
          entry_id: string
          field: string
          id: string
          new_value: string
          old_value: string | null
          source: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          entry_id: string
          field: string
          id?: string
          new_value: string
          old_value?: string | null
          source?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          entry_id?: string
          field?: string
          id?: string
          new_value?: string
          old_value?: string | null
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "title_logline_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_logline_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "title_logline_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "title_logline_history_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      token_bundles: {
        Row: {
          created_at: string
          display_name: string
          enabled: boolean
          id: string
          price_cents: number
          stripe_price_id: string | null
          token_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          enabled?: boolean
          id: string
          price_cents: number
          stripe_price_id?: string | null
          token_amount: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          enabled?: boolean
          id?: string
          price_cents?: number
          stripe_price_id?: string | null
          token_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      token_wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      universe_canonical_narrative: {
        Row: {
          central_pattern: string | null
          core_need: string | null
          core_obstacle: string | null
          core_want: string | null
          created_at: string
          created_by: string
          equilibrium_state: string | null
          id: string
          intended_turn: string | null
          structure_model: string
          theme_claim: string | null
          theme_counterclaim: string | null
          tradition: string
          universe_id: string
          updated_at: string
        }
        Insert: {
          central_pattern?: string | null
          core_need?: string | null
          core_obstacle?: string | null
          core_want?: string | null
          created_at?: string
          created_by: string
          equilibrium_state?: string | null
          id?: string
          intended_turn?: string | null
          structure_model?: string
          theme_claim?: string | null
          theme_counterclaim?: string | null
          tradition?: string
          universe_id: string
          updated_at?: string
        }
        Update: {
          central_pattern?: string | null
          core_need?: string | null
          core_obstacle?: string | null
          core_want?: string | null
          created_at?: string
          created_by?: string
          equilibrium_state?: string | null
          id?: string
          intended_turn?: string | null
          structure_model?: string
          theme_claim?: string | null
          theme_counterclaim?: string | null
          tradition?: string
          universe_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "universe_canonical_narrative_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: true
            referencedRelation: "project_universes"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_character_aliases: {
        Row: {
          alias_name: string
          canonical_name: string
          created_at: string | null
          id: string
          universe_id: string
        }
        Insert: {
          alias_name: string
          canonical_name: string
          created_at?: string | null
          id?: string
          universe_id: string
        }
        Update: {
          alias_name?: string
          canonical_name?: string
          created_at?: string | null
          id?: string
          universe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "universe_character_aliases_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "project_universes"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_entries: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          sort_order: number
          timeline_end: number
          timeline_start: number
          universe_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          sort_order?: number
          timeline_end?: number
          timeline_start?: number
          universe_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          sort_order?: number
          timeline_end?: number
          timeline_start?: number
          universe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "universe_entries_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_entries_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "universe_entries_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_entries_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_entries_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "project_universes"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_narrative_tests: {
        Row: {
          alignment_to_canon: number | null
          brief_id: string | null
          causal_score: Json
          divergence_notes: string[] | null
          entry_id: string | null
          id: string
          model_id: string | null
          relational_score: Json
          run_at: string
          run_by: string
          tradition_detected: string | null
          universe_id: string
        }
        Insert: {
          alignment_to_canon?: number | null
          brief_id?: string | null
          causal_score?: Json
          divergence_notes?: string[] | null
          entry_id?: string | null
          id?: string
          model_id?: string | null
          relational_score?: Json
          run_at?: string
          run_by: string
          tradition_detected?: string | null
          universe_id: string
        }
        Update: {
          alignment_to_canon?: number | null
          brief_id?: string | null
          causal_score?: Json
          divergence_notes?: string[] | null
          entry_id?: string | null
          id?: string
          model_id?: string | null
          relational_score?: Json
          run_at?: string
          run_by?: string
          tradition_detected?: string | null
          universe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "universe_narrative_tests_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "project_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_narrative_tests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_narrative_tests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "universe_narrative_tests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_narrative_tests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_narrative_tests_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "project_universes"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_bonuses_claimed: {
        Row: {
          claimed_at: string
          id: string
          length_category: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          id?: string
          length_category: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          id?: string
          length_category?: string
          user_id?: string
        }
        Relationships: []
      }
      user_badges: {
        Row: {
          badge_icon: string
          badge_key: string
          badge_label: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          badge_icon?: string
          badge_key: string
          badge_label: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          badge_icon?: string
          badge_key?: string
          badge_label?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_feature_grants: {
        Row: {
          created_at: string
          expires_at: string | null
          feature_id: string
          granted_by: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          feature_id: string
          granted_by: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          feature_id?: string
          granted_by?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_genre_stats: {
        Row: {
          count: number
          first_submitted_at: string
          genre: string
          id: string
          user_id: string
        }
        Insert: {
          count?: number
          first_submitted_at?: string
          genre: string
          id?: string
          user_id: string
        }
        Update: {
          count?: number
          first_submitted_at?: string
          genre?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_module_grants: {
        Row: {
          created_at: string
          expires_at: string | null
          granted_by: string
          id: string
          module_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          granted_by: string
          id?: string
          module_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string
          id?: string
          module_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_module_grants_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "module_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voice_drift_analysis: {
        Row: {
          created_at: string
          details: Json | null
          drift_score: number | null
          entry_id: string
          flagged: boolean | null
          id: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          drift_score?: number | null
          entry_id: string
          flagged?: boolean | null
          id?: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          drift_score?: number | null
          entry_id?: string
          flagged?: boolean | null
          id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          idempotency_key: string | null
          label: string
          source: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          label: string
          source?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          label?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      writing_daily_stats: {
        Row: {
          active_minutes: number
          day: string
          pages_written: number
          sessions_count: number
          updated_at: string
          user_id: string
          words_written: number
        }
        Insert: {
          active_minutes?: number
          day: string
          pages_written?: number
          sessions_count?: number
          updated_at?: string
          user_id: string
          words_written?: number
        }
        Update: {
          active_minutes?: number
          day?: string
          pages_written?: number
          sessions_count?: number
          updated_at?: string
          user_id?: string
          words_written?: number
        }
        Relationships: []
      }
      writing_goals: {
        Row: {
          created_at: string
          daily_word_goal: number
          streak_grace_days: number
          updated_at: string
          user_id: string
          weekly_word_goal: number
        }
        Insert: {
          created_at?: string
          daily_word_goal?: number
          streak_grace_days?: number
          updated_at?: string
          user_id: string
          weekly_word_goal?: number
        }
        Update: {
          created_at?: string
          daily_word_goal?: number
          streak_grace_days?: number
          updated_at?: string
          user_id?: string
          weekly_word_goal?: number
        }
        Relationships: []
      }
      writing_milestones: {
        Row: {
          detected_at: string
          draft_id: string | null
          entry_id: string | null
          id: string
          kind: string
          page_at_detect: number | null
          user_id: string
        }
        Insert: {
          detected_at?: string
          draft_id?: string | null
          entry_id?: string | null
          id?: string
          kind: string
          page_at_detect?: number | null
          user_id: string
        }
        Update: {
          detected_at?: string
          draft_id?: string | null
          entry_id?: string | null
          id?: string
          kind?: string
          page_at_detect?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "writing_milestones_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "screenplay_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_milestones_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "v_screenplay_drafts_divergence"
            referencedColumns: ["draft_id"]
          },
          {
            foreignKeyName: "writing_milestones_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_milestones_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "writing_milestones_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_milestones_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_sessions: {
        Row: {
          created_at: string
          draft_id: string | null
          duration_seconds: number
          ended_at: string
          entry_id: string | null
          id: string
          pages_end: number
          started_at: string
          user_id: string
          words_delta: number
          words_end: number
          words_start: number
        }
        Insert: {
          created_at?: string
          draft_id?: string | null
          duration_seconds?: number
          ended_at?: string
          entry_id?: string | null
          id?: string
          pages_end?: number
          started_at?: string
          user_id: string
          words_delta?: number
          words_end?: number
          words_start?: number
        }
        Update: {
          created_at?: string
          draft_id?: string | null
          duration_seconds?: number
          ended_at?: string
          entry_id?: string | null
          id?: string
          pages_end?: number
          started_at?: string
          user_id?: string
          words_delta?: number
          words_end?: number
          words_start?: number
        }
        Relationships: [
          {
            foreignKeyName: "writing_sessions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "screenplay_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_sessions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "v_screenplay_drafts_divergence"
            referencedColumns: ["draft_id"]
          },
          {
            foreignKeyName: "writing_sessions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_sessions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "narrative_gate_shadow_report"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "writing_sessions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "public_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_sessions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qi_list_entries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      competition_judge_config_safe: {
        Row: {
          awards: Json | null
          competition_id: string | null
          created_at: string | null
          finalized: boolean | null
          finalized_at: string | null
          finalized_by: string | null
          guidelines: string | null
          id: string | null
          judging_mode: string | null
          locked: boolean | null
          locked_at: string | null
          max_variance_allowed: number | null
          min_judges_required: number | null
          mode_settings: Json | null
          model_id: string | null
          model_provider: string | null
          rubric_preset: string | null
          rubric_version: number | null
          rules: string | null
          scoring_weights: Json | null
          stipulations: Json | null
          updated_at: string | null
        }
        Insert: {
          awards?: Json | null
          competition_id?: string | null
          created_at?: string | null
          finalized?: boolean | null
          finalized_at?: string | null
          finalized_by?: string | null
          guidelines?: string | null
          id?: string | null
          judging_mode?: string | null
          locked?: boolean | null
          locked_at?: string | null
          max_variance_allowed?: number | null
          min_judges_required?: number | null
          mode_settings?: Json | null
          model_id?: string | null
          model_provider?: string | null
          rubric_preset?: string | null
          rubric_version?: number | null
          rules?: string | null
          scoring_weights?: Json | null
          stipulations?: Json | null
          updated_at?: string | null
        }
        Update: {
          awards?: Json | null
          competition_id?: string | null
          created_at?: string | null
          finalized?: boolean | null
          finalized_at?: string | null
          finalized_by?: string | null
          guidelines?: string | null
          id?: string | null
          judging_mode?: string | null
          locked?: boolean | null
          locked_at?: string | null
          max_variance_allowed?: number | null
          min_judges_required?: number | null
          mode_settings?: Json | null
          model_id?: string | null
          model_provider?: string | null
          rubric_preset?: string | null
          rubric_version?: number | null
          rules?: string | null
          scoring_weights?: Json | null
          stipulations?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_judge_config_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: true
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      narrative_gate_shadow_report: {
        Row: {
          classification: string | null
          entry_created_at: string | null
          entry_id: string | null
          gate_run_at: string | null
          governance_event_id: string | null
          labeled_at: string | null
          labeled_by: string | null
          title: string | null
          truth_has_violation: boolean | null
          verdict: string | null
          violation_count: number | null
        }
        Relationships: []
      }
      public_entries: {
        Row: {
          ai_fields: Json | null
          author: string | null
          competition_id: string | null
          created_at: string | null
          dev_stage: Database["public"]["Enums"]["dev_stage"] | null
          draft_number: number | null
          genre: string | null
          id: string | null
          length_category: string | null
          logline: string | null
          method_type: Database["public"]["Enums"]["method_type"] | null
          page_count: number | null
          sensitivity: string | null
          status: Database["public"]["Enums"]["entry_status"] | null
          title: string | null
          updated_at: string | null
          user_id: string | null
          visibility: string | null
        }
        Insert: {
          ai_fields?: Json | null
          author?: string | null
          competition_id?: string | null
          created_at?: string | null
          dev_stage?: Database["public"]["Enums"]["dev_stage"] | null
          draft_number?: number | null
          genre?: string | null
          id?: string | null
          length_category?: string | null
          logline?: string | null
          method_type?: Database["public"]["Enums"]["method_type"] | null
          page_count?: number | null
          sensitivity?: string | null
          status?: Database["public"]["Enums"]["entry_status"] | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          visibility?: string | null
        }
        Update: {
          ai_fields?: Json | null
          author?: string | null
          competition_id?: string | null
          created_at?: string | null
          dev_stage?: Database["public"]["Enums"]["dev_stage"] | null
          draft_number?: number | null
          genre?: string | null
          id?: string | null
          length_category?: string | null
          logline?: string | null
          method_type?: Database["public"]["Enums"]["method_type"] | null
          page_count?: number | null
          sensitivity?: string | null
          status?: Database["public"]["Enums"]["entry_status"] | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entries_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      qi_list_entries: {
        Row: {
          ai_fields: Json | null
          author: string | null
          competition_id: string | null
          created_at: string | null
          dev_stage: Database["public"]["Enums"]["dev_stage"] | null
          draft_number: number | null
          genre: string | null
          id: string | null
          length_category: string | null
          logline: string | null
          method_type: Database["public"]["Enums"]["method_type"] | null
          model_used: string | null
          page_count: number | null
          sensitivity: string | null
          sharing_mode: string | null
          status: Database["public"]["Enums"]["entry_status"] | null
          title: string | null
          updated_at: string | null
          user_id: string | null
          visibility: string | null
        }
        Insert: {
          ai_fields?: Json | null
          author?: string | null
          competition_id?: string | null
          created_at?: string | null
          dev_stage?: Database["public"]["Enums"]["dev_stage"] | null
          draft_number?: number | null
          genre?: string | null
          id?: string | null
          length_category?: string | null
          logline?: string | null
          method_type?: Database["public"]["Enums"]["method_type"] | null
          model_used?: string | null
          page_count?: number | null
          sensitivity?: string | null
          sharing_mode?: string | null
          status?: Database["public"]["Enums"]["entry_status"] | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          visibility?: string | null
        }
        Update: {
          ai_fields?: Json | null
          author?: string | null
          competition_id?: string | null
          created_at?: string | null
          dev_stage?: Database["public"]["Enums"]["dev_stage"] | null
          draft_number?: number | null
          genre?: string | null
          id?: string | null
          length_category?: string | null
          logline?: string | null
          method_type?: Database["public"]["Enums"]["method_type"] | null
          model_used?: string | null
          page_count?: number | null
          sensitivity?: string | null
          sharing_mode?: string | null
          status?: Database["public"]["Enums"]["entry_status"] | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entries_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_audience_vote_aggregates: {
        Row: {
          average_rating: number | null
          max_rating: number | null
          min_rating: number | null
          session_id: string | null
          vote_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "screening_audience_votes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "screening_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      v_entry_scorecard: {
        Row: {
          audience: number | null
          character_depth: number | null
          character_score: number | null
          dialogue: number | null
          emotion: number | null
          emotional: number | null
          entry_id: string | null
          finalized_model_id: string | null
          format_adherence: number | null
          franchise: number | null
          grading_report_count: number | null
          judge_count: number | null
          market: number | null
          narrative: number | null
          originality: number | null
          panel_model_count: number | null
          production: number | null
          rubric_preset: string | null
          rubric_version: number | null
          source: string | null
          structure: number | null
          theme: number | null
          total_score: number | null
          updated_at: string | null
          visual: number | null
        }
        Relationships: []
      }
      v_judge_entry_blind: {
        Row: {
          competition_id: string | null
          created_at: string | null
          dev_stage: Database["public"]["Enums"]["dev_stage"] | null
          genre: string | null
          id: string | null
          import_batch_id: string | null
          judging_tier: Database["public"]["Enums"]["judging_tier"] | null
          length_category: string | null
          logline: string | null
          method_type: Database["public"]["Enums"]["method_type"] | null
          page_count: number | null
          rubric_preset: string | null
          rubric_version: number | null
          script_text: string | null
          source: string | null
          status: Database["public"]["Enums"]["entry_status"] | null
          title: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_screenplay_drafts_divergence: {
        Row: {
          artifact_id: string | null
          artifact_version: number | null
          draft_id: string | null
          legacy_hash: string | null
          legacy_len: number | null
          mirror_hash: string | null
          mirror_len: number | null
          owner_id: string | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_legacy_map_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_collaborator_invitation: {
        Args: { p_token: string }
        Returns: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          entry_id: string
          expires_at: string
          id: string
          invited_by: string
          last_sent_at: string | null
          role: Database["public"]["Enums"]["collab_role"]
          send_count: number
          status: Database["public"]["Enums"]["collab_invitation_status"]
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "collaborator_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_tokens: {
        Args: {
          p_amount: number
          p_label?: string
          p_source?: string
          p_user_id: string
        }
        Returns: number
      }
      admin_shield_certificates_by_competition: {
        Args: { _days?: number }
        Returns: {
          certificate_count: number
          competition_id: string
          competition_name: string
          issuance_rate: number
          last_issued_at: string
          scored_count: number
        }[]
      }
      admin_shield_entries_by_mode: {
        Args: { _competition_id: string; _days: number; _mode: string }
        Returns: {
          ai_used: boolean
          authorship_integrity_score: number
          certificate_number: string
          competition_id: string
          competition_name: string
          created_at: string
          entry_id: string
          has_certificate: boolean
          human_revision_level: number
          market_substitution_risk: number
          originality_score: number
          project_title: string
          provenance_score: number
          risk_band: string
          submission_id: string
          user_id: string
          writer_name: string
        }[]
      }
      admin_shield_risk_distribution: {
        Args: { _competition_id?: string; _days?: number }
        Returns: {
          count: number
          risk_band: string
        }[]
      }
      admin_shield_score_trends: {
        Args: { _competition_id?: string; _days?: number }
        Returns: {
          avg_integrity: number
          avg_originality: number
          avg_provenance: number
          avg_substitution_risk: number
          bucket: string
          runs: number
        }[]
      }
      admin_shield_score_trends_by_mode: {
        Args: { _competition_id?: string; _days?: number }
        Returns: {
          avg_integrity: number
          avg_originality: number
          avg_provenance: number
          avg_substitution_risk: number
          bucket: string
          mode: string
          runs: number
        }[]
      }
      award_leaderboard_badges: {
        Args: { p_competition_id: string }
        Returns: Json
      }
      award_submission_badges:
        | { Args: { p_user_id: string }; Returns: undefined }
        | {
            Args: { p_category?: string; p_genre?: string; p_user_id: string }
            Returns: undefined
          }
      bulk_moderate_brief_comments: {
        Args: { p_action: string; p_comment_ids: string[] }
        Returns: number
      }
      can_edit_cash_burn: {
        Args: {
          _scope: Database["public"]["Enums"]["cash_burn_scope"]
          _scope_id: string
        }
        Returns: boolean
      }
      can_moderate_brief: { Args: { _brief_id: string }; Returns: boolean }
      can_view_cash_burn: {
        Args: {
          _scope: Database["public"]["Enums"]["cash_burn_scope"]
          _scope_id: string
        }
        Returns: boolean
      }
      can_view_judge_panel: { Args: { _entry: string }; Returns: boolean }
      canonical_json: { Args: { _v: Json }; Returns: string }
      get_project_evidence_recording_context_v1: {
        Args: {
          p_context_bundle_id: string
          p_entry_id: string
          p_project_id: string
        }
        Returns: {
          context_bundle_id: string
          context_payload_hash: string
          entry_id: string
          project_id: string
          recording_base_hash: string
        }[]
      }
      cast_feature_vote: {
        Args: { p_feature_id: string; p_tokens_bid: number }
        Returns: string
      }
      collab_role_rank: {
        Args: { _role: Database["public"]["Enums"]["collab_role"] }
        Returns: number
      }
      create_collaborator_invitation: {
        Args: {
          p_email: string
          p_entry_id: string
          p_role?: Database["public"]["Enums"]["collab_role"]
        }
        Returns: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          entry_id: string
          expires_at: string
          id: string
          invited_by: string
          last_sent_at: string | null
          role: Database["public"]["Enums"]["collab_role"]
          send_count: number
          status: Database["public"]["Enums"]["collab_invitation_status"]
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "collaborator_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      credit_tokens_atomic: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_label: string
          p_source?: string
          p_user_id: string
        }
        Returns: {
          new_balance: number
          replayed: boolean
          transaction_id: string
        }[]
      }
      current_rubric_version: { Args: { _preset: string }; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      diff_rubric_definitions: {
        Args: { new_def: Json; old_def: Json }
        Returns: Json
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      end_screening: {
        Args: { _session_id: string }
        Returns: {
          competition_id: string
          created_at: string
          ended_at: string | null
          entry_id: string
          finalize_reason: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          scheduled_for: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["screening_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "screening_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      finalize_entry_score: { Args: { _entry_id: string }; Returns: Json }
      finalize_screening: {
        Args: { _reason: string; _session_id: string }
        Returns: {
          competition_id: string
          created_at: string
          ended_at: string | null
          entry_id: string
          finalize_reason: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          scheduled_for: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["screening_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "screening_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      find_user_by_email: {
        Args: { lookup_email: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      find_user_by_referral_code: { Args: { code: string }; Returns: string }
      get_brief_engagement_stats: {
        Args: { p_brief_id: string }
        Returns: {
          authenticated_views: number
          comment_count: number
          embed_views: number
          last_viewed_at: string
          public_views: number
          total_views: number
          unique_viewers: number
          views_last_24h: number
          views_last_7d: number
        }[]
      }
      get_brief_moderation_settings: {
        Args: { p_brief_id: string }
        Returns: {
          brief_id: string
          enabled: boolean
          keyword_blocklist: string[]
          max_links: number
          min_confidence: number
          min_length: number
          require_approval: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "brief_moderation_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_competition_audit: {
        Args: { _comp_id: string; _limit?: number }
        Returns: {
          action: string
          created_at: string
          details: Json
          id: string
          user_id: string
        }[]
      }
      get_entry_judging_audit: {
        Args: { _entry_id: string }
        Returns: {
          action: string
          actor_email: string
          created_at: string
          details: Json
          id: string
          user_id: string
        }[]
      }
      get_feature_vote_totals: {
        Args: never
        Returns: {
          feature_id: string
          token_total: number
          vote_count: number
        }[]
      }
      get_finalized_scorecard: { Args: { _session_id: string }; Returns: Json }
      get_latest_shield_scores: {
        Args: { _entry_ids: string[] }
        Returns: {
          authorship_integrity_score: number
          created_at: string
          entry_id: string
          market_substitution_risk: number
          risk_band: string
          submission_id: string
        }[]
      }
      get_public_profiles: {
        Args: { user_ids: string[] }
        Returns: {
          display_name: string
          pen_name: string
          user_id: string
        }[]
      }
      get_screenplay_signed_url: {
        Args: { expires_in?: number; file_path: string }
        Returns: string
      }
      get_user_plan: { Args: { p_user_id: string }; Returns: string }
      get_user_tiers: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["access_tier"][]
      }
      has_access_tier: {
        Args: {
          _tier: Database["public"]["Enums"]["access_tier"]
          _user_id: string
        }
        Returns: boolean
      }
      has_entry_access: {
        Args: {
          _entry_id: string
          _min_role?: Database["public"]["Enums"]["collab_role"]
        }
        Returns: boolean
      }
      has_entry_disclosure: { Args: { _entry_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invite_entry_collaborator: {
        Args: {
          p_email: string
          p_entry_id: string
          p_role?: Database["public"]["Enums"]["collab_role"]
        }
        Returns: string
      }
      is_competition_judge: {
        Args: { _comp: string; _user: string }
        Returns: boolean
      }
      is_competition_lead: {
        Args: { _comp: string; _user: string }
        Returns: boolean
      }
      is_entry_owner: { Args: { _entry_id: string }; Returns: boolean }
      is_entry_owner_for: {
        Args: { _entry_id: string; _user_id: string }
        Returns: boolean
      }
      iso_utc_ms: { Args: { _ts: string }; Returns: string }
      judge_visible_entries: {
        Args: never
        Returns: {
          competition_id: string
          created_at: string
          dev_stage: Database["public"]["Enums"]["dev_stage"]
          genre: string
          id: string
          import_batch_id: string
          judging_tier: Database["public"]["Enums"]["judging_tier"]
          length_category: string
          logline: string
          method_type: Database["public"]["Enums"]["method_type"]
          page_count: number
          rubric_preset: string
          rubric_version: number
          script_text: string
          source: string
          status: Database["public"]["Enums"]["entry_status"]
          title: string
          updated_at: string
        }[]
      }
      linear_dedupe_or_throttle: {
        Args: {
          p_cooldown_minutes?: number
          p_correlation_id?: string
          p_dedup_key: string
          p_labels?: string[]
          p_payload?: Json
          p_source?: Database["public"]["Enums"]["linear_ticket_source"]
          p_source_record_id?: string
          p_source_table?: string
          p_title?: string
        }
        Returns: Json
      }
      list_brief_comments_by_token: {
        Args: { p_token: string }
        Returns: {
          author_name: string
          body: string
          created_at: string
          id: string
          is_owner: boolean
          parent_comment_id: string
        }[]
      }
      list_brief_views: {
        Args: { p_brief_id: string; p_limit?: number }
        Returns: {
          created_at: string
          id: string
          referrer: string
          surface: string
          user_agent: string
          viewer_user_id: string
        }[]
      }
      list_entry_brief_thread: {
        Args: { p_entry_id: string; p_limit?: number }
        Returns: {
          body: string
          brief_id: string
          brief_title: string
          brief_version_at: string
          brief_version_id: string
          brief_version_source: string
          created_at: string
          entry_id: string
          id: string
          kind: string
          source: string
          user_id: string
        }[]
      }
      list_entry_collaborators: {
        Args: { p_entry_id: string }
        Returns: {
          created_at: string
          display_name: string
          email: string
          invited_by: string
          role: Database["public"]["Enums"]["collab_role"]
          updated_at: string
          user_id: string
        }[]
      }
      list_my_brief_comment_reports: {
        Args: { p_limit?: number }
        Returns: {
          appeal_reason: string
          appeal_requested_at: string
          appeal_resolved_at: string
          appeal_response: string
          appeal_status: string
          brief_id: string
          brief_title: string
          comment_hidden: boolean
          comment_id: string
          comment_preview: string
          created_at: string
          id: string
          reason: string
          reviewed_at: string
          status: string
        }[]
      }
      list_owner_briefs_with_comments: {
        Args: never
        Returns: {
          brief_id: string
          comment_count: number
          pending_count: number
          title: string
        }[]
      }
      list_owner_moderation_queue: {
        Args: {
          p_brief_id?: string
          p_limit?: number
          p_max_score?: number
          p_min_score?: number
          p_offset?: number
          p_search?: string
          p_sort?: string
          p_status?: string
        }
        Returns: {
          author_name: string
          body: string
          brief_id: string
          brief_title: string
          created_at: string
          hidden: boolean
          id: string
          moderation_flags: string[]
          moderation_score: number
          parent_comment_id: string
          pending_approval: boolean
          report_count: number
        }[]
      }
      list_pending_brief_comments: {
        Args: { p_brief_id: string }
        Returns: {
          author_name: string
          body: string
          created_at: string
          hidden: boolean
          id: string
          moderation_flags: string[]
          moderation_score: number
          parent_comment_id: string
          pending_approval: boolean
        }[]
      }
      log_auth_decision: {
        Args: {
          p_decision: string
          p_details?: Json
          p_event_type: string
          p_reason?: string
          p_resource?: string
        }
        Returns: string
      }
      log_author_emulation_flag: {
        Args: {
          _correlation_id: string
          _entry_id: string
          _function_name: string
          _match_kind: string
          _matched_author: string
          _user_id: string
        }
        Returns: string
      }
      log_brief_view_by_token: {
        Args: {
          p_referrer?: string
          p_surface?: string
          p_token: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      lookup_brief_by_token: {
        Args: { p_token: string }
        Returns: {
          confidence: number
          created_at: string
          format_suggestion: string
          id: string
          organized: Json
          requires_password: boolean
          share_expires_at: string
          title: string
          visibility: string
        }[]
      }
      lookup_share_link: {
        Args: { p_token: string }
        Returns: {
          access_type: string
          created_at: string
          created_by: string
          entry_id: string
          expires_at: string
          id: string
          label: string
          revoked_at: string
          token: string
        }[]
      }
      mark_usage_applied: { Args: { p_log_id: string }; Returns: undefined }
      moderate_brief_comment: {
        Args: { p_action: string; p_comment_id: string }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      partner_list_entries: {
        Args: { p_competition_id: string }
        Returns: {
          created_at: string
          genre: string
          id: string
          is_embargoed: boolean
          judging_tier: Database["public"]["Enums"]["judging_tier"]
          length_category: string
          logline: string
          page_count: number
          status: string
          title: string
        }[]
      }
      pmf_degenerate: { Args: { _tier: number }; Returns: Json }
      pmf_entropy: { Args: { _pmf: Json }; Returns: number }
      pmf_expected: { Args: { _pmf: Json }; Returns: number }
      post_brief_comment_by_token:
        | {
            Args: { p_author_name: string; p_body: string; p_token: string }
            Returns: string
          }
        | {
            Args: {
              p_author_name: string
              p_body: string
              p_parent_id?: string
              p_token: string
            }
            Returns: string
          }
      post_entry_brief_message: {
        Args: {
          p_body: string
          p_brief_id?: string
          p_brief_version_id?: string
          p_entry_id: string
          p_kind?: string
          p_source?: string
        }
        Returns: string
      }
      project_attach_artifact: {
        Args: {
          p_artifact_type: Database["public"]["Enums"]["project_artifact_type"]
          p_legacy_id?: string
          p_legacy_table?: Database["public"]["Enums"]["project_legacy_source"]
          p_payload?: Json
          p_project_id: string
          p_storage_path?: string
        }
        Returns: string
      }
      project_evidence_canonical_json_v1: {
        Args: { _v: Json }
        Returns: string
      }
      project_evidence_recording_base_hash_v1: {
        Args: {
          p_context_bundle_id: string
          p_context_created_at: string
          p_context_payload_hash: string
          p_current_artifact_id: string
          p_entry_id: string
          p_lifecycle_state: Database["public"]["Enums"]["project_lifecycle_state"]
          p_owner_id: string
          p_project_id: string
          p_project_updated_at: string
        }
        Returns: string
      }
      project_evidence_sha256_hex_v1: {
        Args: { p_bytes: string }
        Returns: string
      }
      project_transition: {
        Args: {
          p_evidence_hash?: string
          p_project_id: string
          p_reason?: string
          p_to_state: Database["public"]["Enums"]["project_lifecycle_state"]
        }
        Returns: Database["public"]["Enums"]["project_lifecycle_state"]
      }
      record_project_evidence_observation_v1: {
        Args: {
          p_context_bundle_id: string
          p_entry_id: string
          p_expected_context_payload_hash: string
          p_expected_local_byte_length: number
          p_expected_local_sha256: string
          p_expected_recording_base_hash: string
          p_idempotency_key: string
          p_local_exact_bytes_base64: string
          p_local_schema_version: string
          p_project_id: string
          p_record_kind: string
          p_recorded_by: string
        }
        Returns: {
          envelope_sha256: string
          local_sha256: string
          observation_id: string
          observation_state: string
          persistence_effect: string
          recording_base_hash: string
          replayed: boolean
          reused_exact_observation: boolean
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recompute_entry_checklist: {
        Args: { _entry_id: string }
        Returns: undefined
      }
      redact_script_for_judge: { Args: { script: string }; Returns: string }
      refund_feature_tokens: { Args: { p_feature_id: string }; Returns: Json }
      remove_entry_collaborator: {
        Args: { p_entry_id: string; p_user_id: string }
        Returns: undefined
      }
      report_brief_comment_by_token: {
        Args: { p_comment_id: string; p_reason?: string; p_token: string }
        Returns: string
      }
      request_comment_report_appeal: {
        Args: { p_comment_id: string; p_reason: string }
        Returns: number
      }
      resend_collaborator_invitation: {
        Args: { p_invitation_id: string }
        Returns: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          entry_id: string
          expires_at: string
          id: string
          invited_by: string
          last_sent_at: string | null
          role: Database["public"]["Enums"]["collab_role"]
          send_count: number
          status: Database["public"]["Enums"]["collab_invitation_status"]
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "collaborator_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_comment_report_appeal: {
        Args: { p_comment_id: string; p_decision: string; p_response?: string }
        Returns: number
      }
      revoke_collaborator_invitation: {
        Args: { p_invitation_id: string }
        Returns: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          entry_id: string
          expires_at: string
          id: string
          invited_by: string
          last_sent_at: string | null
          role: Database["public"]["Enums"]["collab_role"]
          send_count: number
          status: Database["public"]["Enums"]["collab_invitation_status"]
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "collaborator_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_brief_moderation_settings: {
        Args: {
          p_brief_id: string
          p_enabled: boolean
          p_keyword_blocklist: string[]
          p_max_links: number
          p_min_confidence: number
          p_min_length: number
          p_require_approval: boolean
        }
        Returns: undefined
      }
      set_brief_share_password: {
        Args: { p_brief_id: string; p_password: string }
        Returns: undefined
      }
      spend_tokens:
        | {
            Args: { p_amount: number; p_feature_id?: string }
            Returns: undefined
          }
        | {
            Args: { p_amount: number; p_feature_id: string }
            Returns: undefined
          }
      spend_tokens_atomic: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_label: string
          p_source?: string
          p_user_id: string
        }
        Returns: {
          new_balance: number
          replayed: boolean
          transaction_id: string
        }[]
      }
      start_screening: {
        Args: { _session_id: string }
        Returns: {
          competition_id: string
          created_at: string
          ended_at: string | null
          entry_id: string
          finalize_reason: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          scheduled_for: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["screening_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "screening_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unfinalize_entry_score: {
        Args: { _entry_id: string; _reason: string }
        Returns: Json
      }
      unlock_brief_by_token: {
        Args: { p_password: string; p_token: string }
        Returns: {
          confidence: number
          created_at: string
          format_suggestion: string
          id: string
          organized: Json
          requires_password: boolean
          share_expires_at: string
          title: string
          visibility: string
        }[]
      }
      update_entry_collaborator_role: {
        Args: {
          p_entry_id: string
          p_role: Database["public"]["Enums"]["collab_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      upsert_linear_ticket: {
        Args: {
          _assignee: string
          _correlation_id: string
          _identifier: string
          _labels: string[]
          _linear_id: string
          _payload: Json
          _priority: number
          _source: Database["public"]["Enums"]["linear_ticket_source"]
          _source_record_id: string
          _source_table: string
          _state: string
          _team_key: string
          _title: string
          _url: string
        }
        Returns: string
      }
      verify_authorship_certificate: {
        Args: { _hash: string }
        Returns: {
          authorship_integrity_score: number
          certificate_number: string
          draft_number: string
          issued_at: string
          project_title: string
          revoked_at: string
          risk_band: string
          sha256_hash: string
          status: string
          writer_name: string
        }[]
      }
      verify_pending_invite: { Args: { p_email: string }; Returns: boolean }
    }
    Enums: {
      access_tier:
        | "god_mode"
        | "dev_mode"
        | "administration"
        | "extended"
        | "limited"
        | "user"
      app_role: "admin" | "user" | "tester" | "judge" | "festival" | "studio"
      cash_burn_scope:
        | "workspace"
        | "project"
        | "screenplay"
        | "writer"
        | "franchise"
      collab_invitation_status: "pending" | "accepted" | "revoked" | "expired"
      collab_role: "owner" | "editor" | "reviewer" | "viewer"
      competition_kind: "screenplay" | "ai_film"
      competition_status: "draft" | "open" | "closed" | "judging" | "complete"
      dev_stage:
        | "concept"
        | "outline"
        | "draft"
        | "revised_draft"
        | "submission_ready"
        | "pitch_package_ready"
        | "in_development"
        | "active_development"
      entry_status:
        | "submitted"
        | "judging"
        | "scored"
        | "disqualified"
        | "under_review"
        | "shortlisted"
        | "accepted"
        | "error"
        | "finalized"
        | "withdrawn"
        | "rejected"
      judging_tier: "standard" | "festival" | "finalist"
      linear_ticket_source:
        | "submission"
        | "ai_failure"
        | "support"
        | "manual"
        | "governance"
      method_type: "ai" | "human" | "hybrid"
      parity_role_tier: "lead" | "key" | "supporting" | "consultant"
      plan_tier: "free" | "pro" | "film_festival" | "studio"
      project_artifact_type:
        | "fountain"
        | "pdf"
        | "brief"
        | "qframe_bundle"
        | "coverage"
        | "scorecard"
        | "rewrite_diff"
        | "story_plan"
        | "context_bundle"
        | "preproduction_pack"
        | "okf_concept"
      project_kind: "screenplay" | "brief" | "qframe" | "portfolio"
      project_legacy_source:
        | "entries"
        | "screenplay_drafts"
        | "project_briefs"
        | "qframe_projects"
      project_lifecycle_state:
        | "draft"
        | "in_review"
        | "submitted"
        | "scored"
        | "archived"
      review_status: "requested" | "in_review" | "completed" | "declined"
      review_visibility: "author_only" | "collaborators" | "admin_only"
      runway_milestone_status:
        | "not_started"
        | "in_progress"
        | "complete"
        | "at_risk"
      screening_status: "scheduled" | "live" | "locked" | "finalized"
      share_access_type: "view" | "review"
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
    Enums: {
      access_tier: [
        "god_mode",
        "dev_mode",
        "administration",
        "extended",
        "limited",
        "user",
      ],
      app_role: ["admin", "user", "tester", "judge", "festival", "studio"],
      cash_burn_scope: [
        "workspace",
        "project",
        "screenplay",
        "writer",
        "franchise",
      ],
      collab_invitation_status: ["pending", "accepted", "revoked", "expired"],
      collab_role: ["owner", "editor", "reviewer", "viewer"],
      competition_kind: ["screenplay", "ai_film"],
      competition_status: ["draft", "open", "closed", "judging", "complete"],
      dev_stage: [
        "concept",
        "outline",
        "draft",
        "revised_draft",
        "submission_ready",
        "pitch_package_ready",
        "in_development",
        "active_development",
      ],
      entry_status: [
        "submitted",
        "judging",
        "scored",
        "disqualified",
        "under_review",
        "shortlisted",
        "accepted",
        "error",
        "finalized",
        "withdrawn",
        "rejected",
      ],
      judging_tier: ["standard", "festival", "finalist"],
      linear_ticket_source: [
        "submission",
        "ai_failure",
        "support",
        "manual",
        "governance",
      ],
      method_type: ["ai", "human", "hybrid"],
      parity_role_tier: ["lead", "key", "supporting", "consultant"],
      plan_tier: ["free", "pro", "film_festival", "studio"],
      project_artifact_type: [
        "fountain",
        "pdf",
        "brief",
        "qframe_bundle",
        "coverage",
        "scorecard",
        "rewrite_diff",
        "story_plan",
        "context_bundle",
        "preproduction_pack",
        "okf_concept",
      ],
      project_kind: ["screenplay", "brief", "qframe", "portfolio"],
      project_legacy_source: [
        "entries",
        "screenplay_drafts",
        "project_briefs",
        "qframe_projects",
      ],
      project_lifecycle_state: [
        "draft",
        "in_review",
        "submitted",
        "scored",
        "archived",
      ],
      review_status: ["requested", "in_review", "completed", "declined"],
      review_visibility: ["author_only", "collaborators", "admin_only"],
      runway_milestone_status: [
        "not_started",
        "in_progress",
        "complete",
        "at_risk",
      ],
      screening_status: ["scheduled", "live", "locked", "finalized"],
      share_access_type: ["view", "review"],
    },
  },
} as const
