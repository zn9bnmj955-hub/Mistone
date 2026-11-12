
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ai_usage": {
                  Row: {
                    "cost_micro_eur": number,"day": string,"device_hash": string | null,"id": string,"input_tokens": number,"output_tokens": number,"questions": number,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_micro_eur"?: number,"day"?: string,"device_hash"?: string | null,"id"?: string,"input_tokens"?: number,"output_tokens"?: number,"questions"?: number,"user_id"?: string | null
                  }
                  Update: {
                    "cost_micro_eur"?: number,"day"?: string,"device_hash"?: string | null,"id"?: string,"input_tokens"?: number,"output_tokens"?: number,"questions"?: number,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"announcements": {
                  Row: {
                    "body": string | null,"club_id": string,"created_at": string,"created_by": string | null,"id": string,"link_url": string | null,"published_at": string | null,"sport_slug": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"club_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"link_url"?: string | null,"published_at"?: string | null,"sport_slug"?: string | null,"title": string
                  }
                  Update: {
                    "body"?: string | null,"club_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"link_url"?: string | null,"published_at"?: string | null,"sport_slug"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcements_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcements_sport_slug_fkey"
      columns: ["sport_slug"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["slug"]
    }
                  ]
                },"app_settings": {
                  Row: {
                    "description": string | null,"key": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string | null,"key": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "description"?: string | null,"key"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"club_invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"club_id": string,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"role": Database["public"]['Enums']["club_role"],"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"club_id": string,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"role"?: Database["public"]['Enums']["club_role"],"token_hash": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"club_id"?: string,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"role"?: Database["public"]['Enums']["club_role"],"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_invitations_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    }
                  ]
                },"club_members": {
                  Row: {
                    "club_id": string,"created_at": string,"role": Database["public"]['Enums']["club_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id": string,"created_at"?: string,"role"?: Database["public"]['Enums']["club_role"],"user_id": string
                  }
                  Update: {
                    "club_id"?: string,"created_at"?: string,"role"?: Database["public"]['Enums']["club_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_members_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    }
                  ]
                },"clubs": {
                  Row: {
                    "address": string | null,"affiliation_number": string | null,"city": string | null,"contact_email": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"created_by": string | null,"default_venue_count": number | null,"description": string | null,"federation": string | null,"id": string,"kind": Database["public"]['Enums']["club_kind"],"lat": number | null,"lng": number | null,"logo_path": string | null,"name": string,"postcode": string | null,"slug": string,"sports": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"affiliation_number"?: string | null,"city"?: string | null,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"default_venue_count"?: number | null,"description"?: string | null,"federation"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["club_kind"],"lat"?: number | null,"lng"?: number | null,"logo_path"?: string | null,"name": string,"postcode"?: string | null,"slug": string,"sports"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"affiliation_number"?: string | null,"city"?: string | null,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"default_venue_count"?: number | null,"description"?: string | null,"federation"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["club_kind"],"lat"?: number | null,"lng"?: number | null,"logo_path"?: string | null,"name"?: string,"postcode"?: string | null,"slug"?: string,"sports"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"follows": {
                  Row: {
                    "club_id": string | null,"created_at": string,"id": string,"tournament_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id"?: string | null,"created_at"?: string,"id"?: string,"tournament_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "club_id"?: string | null,"created_at"?: string,"id"?: string,"tournament_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "follows_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follows_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"kb_chunks": {
                  Row: {
                    "content": string,"document_id": string,"id": string,"position": number,"tsv": unknown
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"document_id": string,"id"?: string,"position": number,"tsv"?: never
                  }
                  Update: {
                    "content"?: string,"document_id"?: string,"id"?: string,"position"?: number,"tsv"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "kb_chunks_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "kb_documents"
      referencedColumns: ["id"]
    }
                  ]
                },"kb_documents": {
                  Row: {
                    "body": string,"id": string,"kind": string,"published": boolean,"reviewed_at": string | null,"source_url": string | null,"sport_slug": string | null,"title": string,"updated_at": string,"version_date": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"id"?: string,"kind"?: string,"published"?: boolean,"reviewed_at"?: string | null,"source_url"?: string | null,"sport_slug"?: string | null,"title": string,"updated_at"?: string,"version_date"?: string | null
                  }
                  Update: {
                    "body"?: string,"id"?: string,"kind"?: string,"published"?: boolean,"reviewed_at"?: string | null,"source_url"?: string | null,"sport_slug"?: string | null,"title"?: string,"updated_at"?: string,"version_date"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "kb_documents_sport_slug_fkey"
      columns: ["sport_slug"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["slug"]
    }
                  ]
                },"legal_pages": {
                  Row: {
                    "body": string,"published": boolean,"slug": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string,"published"?: boolean,"slug": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"published"?: boolean,"slug"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"matches": {
                  Row: {
                    "ended_at": string | null,"id": string,"pool": string | null,"position": number,"queued_at": string | null,"round_id": string,"scheduled_at": string | null,"score_a": number | null,"score_b": number | null,"side_a": (string)[] | null,"side_b": (string)[] | null,"started_at": string | null,"status": Database["public"]['Enums']["match_status"],"team_a_id": string | null,"team_b_id": string | null,"tiebreak_a": number | null,"tiebreak_b": number | null,"tournament_id": string,"updated_at": string,"venue_id": string | null,"version": number,"winner_side": string | null,"winner_team_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ended_at"?: string | null,"id"?: string,"pool"?: string | null,"position": number,"queued_at"?: string | null,"round_id": string,"scheduled_at"?: string | null,"score_a"?: number | null,"score_b"?: number | null,"side_a"?: (string)[] | null,"side_b"?: (string)[] | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["match_status"],"team_a_id"?: string | null,"team_b_id"?: string | null,"tiebreak_a"?: number | null,"tiebreak_b"?: number | null,"tournament_id": string,"updated_at"?: string,"venue_id"?: string | null,"version"?: number,"winner_side"?: string | null,"winner_team_id"?: string | null
                  }
                  Update: {
                    "ended_at"?: string | null,"id"?: string,"pool"?: string | null,"position"?: number,"queued_at"?: string | null,"round_id"?: string,"scheduled_at"?: string | null,"score_a"?: number | null,"score_b"?: number | null,"side_a"?: (string)[] | null,"side_b"?: (string)[] | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["match_status"],"team_a_id"?: string | null,"team_b_id"?: string | null,"tiebreak_a"?: number | null,"tiebreak_b"?: number | null,"tournament_id"?: string,"updated_at"?: string,"venue_id"?: string | null,"version"?: number,"winner_side"?: string | null,"winner_team_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "matches_round_id_fkey"
      columns: ["round_id"]
isOneToOne: false
      referencedRelation: "rounds"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_team_a_id_fkey"
      columns: ["team_a_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_team_b_id_fkey"
      columns: ["team_b_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_winner_team_id_fkey"
      columns: ["winner_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"news_items": {
                  Row: {
                    "created_at": string,"id": string,"published_at": string | null,"source_id": string,"title": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"published_at"?: string | null,"source_id": string,"title": string,"url": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"published_at"?: string | null,"source_id"?: string,"title"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "news_items_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "news_sources"
      referencedColumns: ["id"]
    }
                  ]
                },"news_sources": {
                  Row: {
                    "enabled": boolean,"feed_url": string,"id": string,"last_fetched_at": string | null,"name": string,"site_url": string | null,"sport_slug": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "enabled"?: boolean,"feed_url": string,"id"?: string,"last_fetched_at"?: string | null,"name": string,"site_url"?: string | null,"sport_slug"?: string | null
                  }
                  Update: {
                    "enabled"?: boolean,"feed_url"?: string,"id"?: string,"last_fetched_at"?: string | null,"name"?: string,"site_url"?: string | null,"sport_slug"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "news_sources_sport_slug_fkey"
      columns: ["sport_slug"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["slug"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "attempts": number,"body": string | null,"channel": Database["public"]['Enums']["notification_channel"],"created_at": string,"dedupe_key": string | null,"email": string | null,"error": string | null,"id": string,"payload": NonNullable<Json>,"push_subscription_id": string | null,"scheduled_for": string,"sent_at": string | null,"status": Database["public"]['Enums']["notification_status"],"team_id": string | null,"template": string,"title": string | null,"tournament_id": string | null,"url": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"body"?: string | null,"channel": Database["public"]['Enums']["notification_channel"],"created_at"?: string,"dedupe_key"?: string | null,"email"?: string | null,"error"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"push_subscription_id"?: string | null,"scheduled_for"?: string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"team_id"?: string | null,"template": string,"title"?: string | null,"tournament_id"?: string | null,"url"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"body"?: string | null,"channel"?: Database["public"]['Enums']["notification_channel"],"created_at"?: string,"dedupe_key"?: string | null,"email"?: string | null,"error"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"push_subscription_id"?: string | null,"scheduled_for"?: string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"team_id"?: string | null,"template"?: string,"title"?: string | null,"tournament_id"?: string | null,"url"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_push_subscription_id_fkey"
      columns: ["push_subscription_id"]
isOneToOne: false
      referencedRelation: "push_subscriptions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"checkout_url": string | null,"club_id": string,"created_at": string,"created_by": string | null,"currency": string,"customer_email": string | null,"discount_cents": number,"expires_at": string | null,"form_snapshot": NonNullable<Json>,"id": string,"invoice_url": string | null,"paid_at": string | null,"pricing_plan_id": string | null,"promo_code": string | null,"promo_code_id": string | null,"provider": Database["public"]['Enums']["payment_provider"],"receipt_url": string | null,"status": Database["public"]['Enums']["payment_status"],"stripe_checkout_session_id": string | null,"stripe_payment_intent_id": string | null,"tournament_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"checkout_url"?: string | null,"club_id": string,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"customer_email"?: string | null,"discount_cents"?: number,"expires_at"?: string | null,"form_snapshot"?: NonNullable<Json>,"id"?: string,"invoice_url"?: string | null,"paid_at"?: string | null,"pricing_plan_id"?: string | null,"promo_code"?: string | null,"promo_code_id"?: string | null,"provider"?: Database["public"]['Enums']["payment_provider"],"receipt_url"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"stripe_checkout_session_id"?: string | null,"stripe_payment_intent_id"?: string | null,"tournament_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"checkout_url"?: string | null,"club_id"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"customer_email"?: string | null,"discount_cents"?: number,"expires_at"?: string | null,"form_snapshot"?: NonNullable<Json>,"id"?: string,"invoice_url"?: string | null,"paid_at"?: string | null,"pricing_plan_id"?: string | null,"promo_code"?: string | null,"promo_code_id"?: string | null,"provider"?: Database["public"]['Enums']["payment_provider"],"receipt_url"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"stripe_checkout_session_id"?: string | null,"stripe_payment_intent_id"?: string | null,"tournament_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_pricing_plan_id_fkey"
      columns: ["pricing_plan_id"]
isOneToOne: false
      referencedRelation: "pricing_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_promo_code_id_fkey"
      columns: ["promo_code_id"]
isOneToOne: false
      referencedRelation: "promo_codes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_admins": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"players": {
                  Row: {
                    "category": string | null,"club_name": string | null,"club_number": string | null,"first_name": string,"id": string,"is_substitute": boolean,"last_name": string,"position": number,"team_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string | null,"club_name"?: string | null,"club_number"?: string | null,"first_name": string,"id"?: string,"is_substitute"?: boolean,"last_name": string,"position"?: number,"team_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "category"?: string | null,"club_name"?: string | null,"club_number"?: string | null,"first_name"?: string,"id"?: string,"is_substitute"?: boolean,"last_name"?: string,"position"?: number,"team_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "players_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"players_private": {
                  Row: {
                    "license_number": string | null,"player_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "license_number"?: string | null,"player_id": string
                  }
                  Update: {
                    "license_number"?: string | null,"player_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "players_private_player_id_fkey"
      columns: ["player_id"]
isOneToOne: true
      referencedRelation: "players"
      referencedColumns: ["id"]
    }
                  ]
                },"pricing_plans": {
                  Row: {
                    "active": boolean,"code": string,"created_at": string,"currency": string,"description": string | null,"id": string,"label": string,"max_teams": number | null,"price_cents": number,"sort_order": number,"sport_slug": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"code": string,"created_at"?: string,"currency"?: string,"description"?: string | null,"id"?: string,"label": string,"max_teams"?: number | null,"price_cents": number,"sort_order"?: number,"sport_slug"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"code"?: string,"created_at"?: string,"currency"?: string,"description"?: string | null,"id"?: string,"label"?: string,"max_teams"?: number | null,"price_cents"?: number,"sort_order"?: number,"sport_slug"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pricing_plans_sport_slug_fkey"
      columns: ["sport_slug"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["slug"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "active_club_id": string | null,"city": string | null,"created_at": string,"display_name": string | null,"feed_prefs": NonNullable<Json>,"id": string,"is_licensed": boolean | null,"lat": number | null,"level": Database["public"]['Enums']["player_level"] | null,"lng": number | null,"locale": string,"notifications_opt_in": boolean,"onboarded_at": string | null,"postcode": string | null,"search_radius_km": number,"sports": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_club_id"?: string | null,"city"?: string | null,"created_at"?: string,"display_name"?: string | null,"feed_prefs"?: NonNullable<Json>,"id": string,"is_licensed"?: boolean | null,"lat"?: number | null,"level"?: Database["public"]['Enums']["player_level"] | null,"lng"?: number | null,"locale"?: string,"notifications_opt_in"?: boolean,"onboarded_at"?: string | null,"postcode"?: string | null,"search_radius_km"?: number,"sports"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "active_club_id"?: string | null,"city"?: string | null,"created_at"?: string,"display_name"?: string | null,"feed_prefs"?: NonNullable<Json>,"id"?: string,"is_licensed"?: boolean | null,"lat"?: number | null,"level"?: Database["public"]['Enums']["player_level"] | null,"lng"?: number | null,"locale"?: string,"notifications_opt_in"?: boolean,"onboarded_at"?: string | null,"postcode"?: string | null,"search_radius_km"?: number,"sports"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_active_club_id_fkey"
      columns: ["active_club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles_private": {
                  Row: {
                    "license_number": string | null,"phone": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "license_number"?: string | null,"phone"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "license_number"?: string | null,"phone"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"promo_codes": {
                  Row: {
                    "active": boolean,"amount_off_cents": number | null,"code": string,"created_at": string,"description": string | null,"id": string,"max_redemptions": number | null,"percent_off": number | null,"redemptions": number,"updated_at": string,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"amount_off_cents"?: number | null,"code": string,"created_at"?: string,"description"?: string | null,"id"?: string,"max_redemptions"?: number | null,"percent_off"?: number | null,"redemptions"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"amount_off_cents"?: number | null,"code"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"max_redemptions"?: number | null,"percent_off"?: number | null,"redemptions"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"failed_count": number,"id": string,"last_success_at": string | null,"p256dh": string,"team_id": string | null,"tournament_id": string | null,"updated_at": string,"user_agent": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"failed_count"?: number,"id"?: string,"last_success_at"?: string | null,"p256dh": string,"team_id"?: string | null,"tournament_id"?: string | null,"updated_at"?: string,"user_agent"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"failed_count"?: number,"id"?: string,"last_success_at"?: string | null,"p256dh"?: string,"team_id"?: string | null,"tournament_id"?: string | null,"updated_at"?: string,"user_agent"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_subscriptions_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "push_subscriptions_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"push_targets": {
                  Row: {
                    "created_at": string,"id": string,"subscription_id": string,"team_id": string | null,"tournament_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"subscription_id": string,"team_id"?: string | null,"tournament_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"subscription_id"?: string,"team_id"?: string | null,"tournament_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_targets_subscription_id_fkey"
      columns: ["subscription_id"]
isOneToOne: false
      referencedRelation: "push_subscriptions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "push_targets_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "push_targets_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"rate_limits": {
                  Row: {
                    "count": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count": number,"key": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"registrations": {
                  Row: {
                    "accepted_rules_at": string | null,"captain_email": string | null,"captain_name": string | null,"captain_phone": string | null,"created_at": string,"device_token_hash": string | null,"id": string,"source": Database["public"]['Enums']["registration_source"],"team_id": string,"tournament_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_rules_at"?: string | null,"captain_email"?: string | null,"captain_name"?: string | null,"captain_phone"?: string | null,"created_at"?: string,"device_token_hash"?: string | null,"id"?: string,"source": Database["public"]['Enums']["registration_source"],"team_id": string,"tournament_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "accepted_rules_at"?: string | null,"captain_email"?: string | null,"captain_name"?: string | null,"captain_phone"?: string | null,"created_at"?: string,"device_token_hash"?: string | null,"id"?: string,"source"?: Database["public"]['Enums']["registration_source"],"team_id"?: string,"tournament_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "registrations_team_id_fkey"
      columns: ["team_id"]
isOneToOne: true
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "registrations_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"rounds": {
                  Row: {
                    "bracket": Database["public"]['Enums']["bracket_kind"],"drawn_at": string | null,"id": string,"kind": Database["public"]['Enums']["round_kind"],"number": number,"phase": string,"seed": string | null,"status": Database["public"]['Enums']["round_status"],"tournament_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bracket"?: Database["public"]['Enums']["bracket_kind"],"drawn_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["round_kind"],"number": number,"phase"?: string,"seed"?: string | null,"status"?: Database["public"]['Enums']["round_status"],"tournament_id": string
                  }
                  Update: {
                    "bracket"?: Database["public"]['Enums']["bracket_kind"],"drawn_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["round_kind"],"number"?: number,"phase"?: string,"seed"?: string | null,"status"?: Database["public"]['Enums']["round_status"],"tournament_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rounds_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"score_submissions": {
                  Row: {
                    "confirmed_at": string | null,"created_at": string,"id": string,"match_id": string,"score_a": number,"score_b": number,"side": string | null,"status": Database["public"]['Enums']["score_submission_status"],"submitted_by_team": string | null,"submitted_by_user": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_at"?: string | null,"created_at"?: string,"id"?: string,"match_id": string,"score_a": number,"score_b": number,"side"?: string | null,"status"?: Database["public"]['Enums']["score_submission_status"],"submitted_by_team"?: string | null,"submitted_by_user"?: string | null
                  }
                  Update: {
                    "confirmed_at"?: string | null,"created_at"?: string,"id"?: string,"match_id"?: string,"score_a"?: number,"score_b"?: number,"side"?: string | null,"status"?: Database["public"]['Enums']["score_submission_status"],"submitted_by_team"?: string | null,"submitted_by_user"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "score_submissions_match_id_fkey"
      columns: ["match_id"]
isOneToOne: false
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "score_submissions_submitted_by_team_fkey"
      columns: ["submitted_by_team"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"sports": {
                  Row: {
                    "config": NonNullable<Json>,"enabled": boolean,"name": string,"slug": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config": NonNullable<Json>,"enabled"?: boolean,"name": string,"slug": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"enabled"?: boolean,"name"?: string,"slug"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"team_secrets": {
                  Row: {
                    "code": string,"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"team_id": string
                  }
                  Update: {
                    "code"?: string,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_secrets_team_id_fkey"
      columns: ["team_id"]
isOneToOne: true
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"teams": {
                  Row: {
                    "bracket": Database["public"]['Enums']["bracket_kind"],"bracket_entries": (Database["public"]['Enums']["bracket_kind"])[],"checked_in_at": string | null,"club_name": string | null,"created_at": string,"id": string,"name": string | null,"number": number,"seed": number | null,"status": Database["public"]['Enums']["team_status"],"tournament_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bracket"?: Database["public"]['Enums']["bracket_kind"],"bracket_entries"?: (Database["public"]['Enums']["bracket_kind"])[],"checked_in_at"?: string | null,"club_name"?: string | null,"created_at"?: string,"id"?: string,"name"?: string | null,"number": number,"seed"?: number | null,"status"?: Database["public"]['Enums']["team_status"],"tournament_id": string
                  }
                  Update: {
                    "bracket"?: Database["public"]['Enums']["bracket_kind"],"bracket_entries"?: (Database["public"]['Enums']["bracket_kind"])[],"checked_in_at"?: string | null,"club_name"?: string | null,"created_at"?: string,"id"?: string,"name"?: string | null,"number"?: number,"seed"?: number | null,"status"?: Database["public"]['Enums']["team_status"],"tournament_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "teams_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"tournament_actions": {
                  Row: {
                    "actor_label": string | null,"actor_staff_id": string | null,"actor_user_id": string | null,"changes": Json | null,"client_op_id": string | null,"created_at": string,"id": number,"inverse": Json | null,"payload": NonNullable<Json>,"source": string,"state_version": number | null,"tournament_id": string,"type": string,"undone_at": string | null,"undone_by_action": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_label"?: string | null,"actor_staff_id"?: string | null,"actor_user_id"?: string | null,"changes"?: Json | null,"client_op_id"?: string | null,"created_at"?: string,"id"?: never,"inverse"?: Json | null,"payload"?: NonNullable<Json>,"source"?: string,"state_version"?: number | null,"tournament_id": string,"type": string,"undone_at"?: string | null,"undone_by_action"?: number | null
                  }
                  Update: {
                    "actor_label"?: string | null,"actor_staff_id"?: string | null,"actor_user_id"?: string | null,"changes"?: Json | null,"client_op_id"?: string | null,"created_at"?: string,"id"?: never,"inverse"?: Json | null,"payload"?: NonNullable<Json>,"source"?: string,"state_version"?: number | null,"tournament_id"?: string,"type"?: string,"undone_at"?: string | null,"undone_by_action"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tournament_actions_actor_staff_id_fkey"
      columns: ["actor_staff_id"]
isOneToOne: false
      referencedRelation: "tournament_staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_actions_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_actions_undone_by_action_fkey"
      columns: ["undone_by_action"]
isOneToOne: false
      referencedRelation: "tournament_actions"
      referencedColumns: ["id"]
    }
                  ]
                },"tournament_staff": {
                  Row: {
                    "created_at": string,"email": string | null,"id": string,"label": string,"phone": string | null,"pin_hash": string | null,"revoked_at": string | null,"role": Database["public"]['Enums']["staff_role"],"tournament_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"id"?: string,"label": string,"phone"?: string | null,"pin_hash"?: string | null,"revoked_at"?: string | null,"role": Database["public"]['Enums']["staff_role"],"tournament_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"id"?: string,"label"?: string,"phone"?: string | null,"pin_hash"?: string | null,"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["staff_role"],"tournament_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tournament_staff_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"tournaments": {
                  Row: {
                    "address": string | null,"category": string,"checkin_closes_at": string | null,"city": string | null,"club_id": string,"config": NonNullable<Json>,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"created_by": string | null,"draft_form": NonNullable<Json>,"draft_step": string | null,"draw_seed": string | null,"eligibility": Database["public"]['Enums']["eligibility"],"estimated_end_at": string | null,"fee_cents": number,"fee_per": string,"finished_at": string | null,"food": string | null,"id": string,"lat": number | null,"lng": number | null,"max_teams": number | null,"name": string,"name_display": Database["public"]['Enums']["name_display"],"parking": string | null,"postcode": string | null,"poster_path": string | null,"pricing_plan_id": string | null,"prize_text": string | null,"published_at": string | null,"purged_at": string | null,"registration_closes_at": string | null,"registration_mode": Database["public"]['Enums']["registration_mode"],"rules_pdf_path": string | null,"rules_text": string | null,"short_code": string | null,"sport_slug": string,"starts_at": string | null,"state_version": number,"status": Database["public"]['Enums']["tournament_status"],"team_format": string | null,"updated_at": string,"waitlist_enabled": boolean,"welcome_message": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"category"?: string,"checkin_closes_at"?: string | null,"city"?: string | null,"club_id": string,"config"?: NonNullable<Json>,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"draft_form"?: NonNullable<Json>,"draft_step"?: string | null,"draw_seed"?: string | null,"eligibility"?: Database["public"]['Enums']["eligibility"],"estimated_end_at"?: string | null,"fee_cents"?: number,"fee_per"?: string,"finished_at"?: string | null,"food"?: string | null,"id"?: string,"lat"?: number | null,"lng"?: number | null,"max_teams"?: number | null,"name": string,"name_display"?: Database["public"]['Enums']["name_display"],"parking"?: string | null,"postcode"?: string | null,"poster_path"?: string | null,"pricing_plan_id"?: string | null,"prize_text"?: string | null,"published_at"?: string | null,"purged_at"?: string | null,"registration_closes_at"?: string | null,"registration_mode"?: Database["public"]['Enums']["registration_mode"],"rules_pdf_path"?: string | null,"rules_text"?: string | null,"short_code"?: string | null,"sport_slug": string,"starts_at"?: string | null,"state_version"?: number,"status"?: Database["public"]['Enums']["tournament_status"],"team_format"?: string | null,"updated_at"?: string,"waitlist_enabled"?: boolean,"welcome_message"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"category"?: string,"checkin_closes_at"?: string | null,"city"?: string | null,"club_id"?: string,"config"?: NonNullable<Json>,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"draft_form"?: NonNullable<Json>,"draft_step"?: string | null,"draw_seed"?: string | null,"eligibility"?: Database["public"]['Enums']["eligibility"],"estimated_end_at"?: string | null,"fee_cents"?: number,"fee_per"?: string,"finished_at"?: string | null,"food"?: string | null,"id"?: string,"lat"?: number | null,"lng"?: number | null,"max_teams"?: number | null,"name"?: string,"name_display"?: Database["public"]['Enums']["name_display"],"parking"?: string | null,"postcode"?: string | null,"poster_path"?: string | null,"pricing_plan_id"?: string | null,"prize_text"?: string | null,"published_at"?: string | null,"purged_at"?: string | null,"registration_closes_at"?: string | null,"registration_mode"?: Database["public"]['Enums']["registration_mode"],"rules_pdf_path"?: string | null,"rules_text"?: string | null,"short_code"?: string | null,"sport_slug"?: string,"starts_at"?: string | null,"state_version"?: number,"status"?: Database["public"]['Enums']["tournament_status"],"team_format"?: string | null,"updated_at"?: string,"waitlist_enabled"?: boolean,"welcome_message"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tournaments_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournaments_pricing_plan_id_fkey"
      columns: ["pricing_plan_id"]
isOneToOne: false
      referencedRelation: "pricing_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournaments_sport_slug_fkey"
      columns: ["sport_slug"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["slug"]
    }
                  ]
                },"venues": {
                  Row: {
                    "available": boolean,"id": string,"label": string,"position": number,"reserved_for_finals": boolean,"tournament_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "available"?: boolean,"id"?: string,"label": string,"position": number,"reserved_for_finals"?: boolean,"tournament_id": string
                  }
                  Update: {
                    "available"?: boolean,"id"?: string,"label"?: string,"position"?: number,"reserved_for_finals"?: boolean,"tournament_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "venues_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "ai_month_cost_micro":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"ai_usage_add":
{ Args: { "p_cost": number,"p_device": string,"p_input": number,"p_output": number,"p_user": string }; Returns: undefined
                           },
"apply_tournament_changes":
{ Args: { "p_action": Json,"p_changes": Json,"p_expected_version": number,"p_tournament": string }; Returns: Json
                           },
"can_manage_tournament":
{ Args: { "p_tournament": string }; Returns: boolean
                           },
"can_see_tournament_private":
{ Args: { "p_tournament": string }; Returns: boolean
                           },
"catalog_tournaments":
{ Args: { "p"?: Json }; Returns: {
              "active_teams": number,"address": string,"category": string,"city": string,"club_name": string,"club_slug": string,"distance_km": number,"eligibility": Database["public"]['Enums']["eligibility"],"fee_cents": number,"fee_per": string,"format": string,"id": string,"lat": number,"lng": number,"max_teams": number,"name": string,"postcode": string,"prize_text": string,"registration_closes_at": string,"registration_mode": Database["public"]['Enums']["registration_mode"],"short_code": string,"sport_slug": string,"starts_at": string,"status": Database["public"]['Enums']["tournament_status"],"team_format": string,"waitlist_teams": number
            }[]
                           },
"club_role_of":
{ Args: { "p_club": string }; Returns: Database["public"]['Enums']["club_role"]
                           },
"distance_km":
{ Args: { "lat1": number,"lat2": number,"lng1": number,"lng2": number }; Returns: number
                           },
"generate_short_code":
{ Args: { "len"?: number }; Returns: string
                           },
"hash_pin":
{ Args: { "p_pin": string }; Returns: string
                           },
"hit_rate_limit":
{ Args: { "p_key": string,"p_max": number,"p_window_seconds": number }; Returns: boolean
                           },
"is_club_admin":
{ Args: { "p_club": string }; Returns: boolean
                           },
"is_club_member":
{ Args: { "p_club": string }; Returns: boolean
                           },
"is_platform_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_tournament_public":
{ Args: { "p_tournament": string }; Returns: boolean
                           },
"kb_search":
{ Args: { "p_limit"?: number,"p_query": string,"p_sport"?: string }; Returns: {
              "content": string,"kind": string,"rank": number,"reviewed_at": string,"source_url": string,"sport_slug": string,"title": string,"version_date": string
            }[]
                           },
"publish_tournament":
{ Args: { "p_fields": Json,"p_payment": string,"p_staff": Json,"p_venues": Json }; Returns: string
                           },
"purge_finished_tournaments":
{ Args: { "p_now"?: string }; Returns: (string)[]
                           },
"rate_limit_exceeded":
{ Args: { "p_key": string,"p_max": number,"p_window_seconds": number }; Returns: boolean
                           },
"refund_rate_limit":
{ Args: { "p_key": string }; Returns: undefined
                           },
"register_team_private":
{ Args: { "p": Json,"p_team": string }; Returns: undefined
                           },
"row_in_tournament":
{ Args: { "p_id": string,"p_key": string,"p_table": string,"p_tournament": string }; Returns: boolean
                           },
"verify_staff_pin":
{ Args: { "p_pin": string,"p_tournament": string }; Returns: string
                           }
          }
          Enums: {
            "bracket_kind": "main"|"consolation"|"consolation_c","club_kind": "federated_club"|"association"|"festival_committee"|"town_hall"|"company"|"other","club_role": "owner"|"admin"|"member","eligibility": "open"|"licensed"|"mixed","match_status": "pending"|"waiting_venue"|"ready"|"playing"|"score_submitted"|"disputed"|"done"|"forfeit"|"bye","name_display": "full"|"initials","notification_channel": "push"|"email"|"sms","notification_status": "queued"|"sent"|"failed"|"skipped","payment_provider": "stripe"|"simulation"|"free","payment_status": "pending"|"paid"|"failed"|"refunded"|"expired","player_level": "leisure"|"competition","registration_mode": "online"|"onsite"|"both","registration_source": "online"|"onsite"|"organizer","round_kind": "partie"|"cadrage","round_status": "pending"|"drawn"|"live"|"finished","score_submission_status": "pending"|"confirmed"|"disputed"|"superseded","staff_role": "organizer"|"co_organizer"|"referee","team_status": "registered"|"waitlist"|"checked_in"|"forfeit"|"withdrawn","tournament_status": "draft"|"published"|"registration_closed"|"check_in"|"live"|"finished"|"archived"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "bracket_kind": ["main", "consolation", "consolation_c"],"club_kind": ["federated_club", "association", "festival_committee", "town_hall", "company", "other"],"club_role": ["owner", "admin", "member"],"eligibility": ["open", "licensed", "mixed"],"match_status": ["pending", "waiting_venue", "ready", "playing", "score_submitted", "disputed", "done", "forfeit", "bye"],"name_display": ["full", "initials"],"notification_channel": ["push", "email", "sms"],"notification_status": ["queued", "sent", "failed", "skipped"],"payment_provider": ["stripe", "simulation", "free"],"payment_status": ["pending", "paid", "failed", "refunded", "expired"],"player_level": ["leisure", "competition"],"registration_mode": ["online", "onsite", "both"],"registration_source": ["online", "onsite", "organizer"],"round_kind": ["partie", "cadrage"],"round_status": ["pending", "drawn", "live", "finished"],"score_submission_status": ["pending", "confirmed", "disputed", "superseded"],"staff_role": ["organizer", "co_organizer", "referee"],"team_status": ["registered", "waitlist", "checked_in", "forfeit", "withdrawn"],"tournament_status": ["draft", "published", "registration_closed", "check_in", "live", "finished", "archived"]
          }
        }
} as const
