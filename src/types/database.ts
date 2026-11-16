
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "ai_generations": {
                  Row: {
                    "created_at": string,"error": string | null,"id": string,"input": NonNullable<Json>,"input_tokens": number | null,"model": string,"output": Json | null,"output_tokens": number | null,"provider": string,"user_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"error"?: string | null,"id"?: string,"input": NonNullable<Json>,"input_tokens"?: number | null,"model": string,"output"?: Json | null,"output_tokens"?: number | null,"provider": string,"user_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"error"?: string | null,"id"?: string,"input"?: NonNullable<Json>,"input_tokens"?: number | null,"model"?: string,"output"?: Json | null,"output_tokens"?: number | null,"provider"?: string,"user_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_generations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_lists": {
                  Row: {
                    "campaign_id": string,"list_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"list_id": string,"workspace_id": string
                  }
                  Update: {
                    "campaign_id"?: string,"list_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_lists_campaign_id_workspace_id_fkey"
      columns: ["campaign_id","workspace_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "campaign_lists_list_id_workspace_id_fkey"
      columns: ["list_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contact_lists"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"campaigns": {
                  Row: {
                    "ai_assisted": boolean,"completed_at": string | null,"created_at": string,"created_by": string | null,"from_email": string | null,"from_name": string | null,"html_body": string,"id": string,"name": string,"preview_text": string,"reply_to": string | null,"scheduled_at": string | null,"sender_domain_id": string | null,"started_at": string | null,"status": Database["public"]['Enums']["campaign_status"],"subject": string,"template_id": string | null,"text_body": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_assisted"?: boolean,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"from_email"?: string | null,"from_name"?: string | null,"html_body"?: string,"id"?: string,"name": string,"preview_text"?: string,"reply_to"?: string | null,"scheduled_at"?: string | null,"sender_domain_id"?: string | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["campaign_status"],"subject"?: string,"template_id"?: string | null,"text_body"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "ai_assisted"?: boolean,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"from_email"?: string | null,"from_name"?: string | null,"html_body"?: string,"id"?: string,"name"?: string,"preview_text"?: string,"reply_to"?: string | null,"scheduled_at"?: string | null,"sender_domain_id"?: string | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["campaign_status"],"subject"?: string,"template_id"?: string | null,"text_body"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaigns_sender_domain_id_workspace_id_fkey"
      columns: ["sender_domain_id","workspace_id"]
isOneToOne: false
      referencedRelation: "sender_domains"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "campaigns_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "email_templates"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaigns_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_list_members": {
                  Row: {
                    "added_at": string,"contact_id": string,"list_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"contact_id": string,"list_id": string,"workspace_id": string
                  }
                  Update: {
                    "added_at"?: string,"contact_id"?: string,"list_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_list_members_contact_id_workspace_id_fkey"
      columns: ["contact_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "contact_list_members_list_id_workspace_id_fkey"
      columns: ["list_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contact_lists"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"contact_lists": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"name": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"name": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"name"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_lists_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_tags": {
                  Row: {
                    "contact_id": string,"created_at": string,"tag_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id": string,"created_at"?: string,"tag_id": string,"workspace_id": string
                  }
                  Update: {
                    "contact_id"?: string,"created_at"?: string,"tag_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_tags_contact_id_workspace_id_fkey"
      columns: ["contact_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "contact_tags_tag_id_workspace_id_fkey"
      columns: ["tag_id","workspace_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "archived_at": string | null,"consent_at": string | null,"consent_source": string | null,"created_at": string,"custom_fields": NonNullable<Json>,"email": string,"first_name": string | null,"id": string,"last_name": string | null,"source": string | null,"status": Database["public"]['Enums']["contact_status"],"unsubscribed_at": string | null,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"consent_at"?: string | null,"consent_source"?: string | null,"created_at"?: string,"custom_fields"?: NonNullable<Json>,"email": string,"first_name"?: string | null,"id"?: string,"last_name"?: string | null,"source"?: string | null,"status"?: Database["public"]['Enums']["contact_status"],"unsubscribed_at"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"consent_at"?: string | null,"consent_source"?: string | null,"created_at"?: string,"custom_fields"?: NonNullable<Json>,"email"?: string,"first_name"?: string | null,"id"?: string,"last_name"?: string | null,"source"?: string | null,"status"?: Database["public"]['Enums']["contact_status"],"unsubscribed_at"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"csv_imports": {
                  Row: {
                    "column_mapping": NonNullable<Json>,"completed_at": string | null,"consent_source": string | null,"created_at": string,"created_by": string | null,"errors": NonNullable<Json>,"id": string,"inserted_rows": number,"list_id": string | null,"skipped_rows": number,"status": Database["public"]['Enums']["import_status"],"storage_path": string,"total_rows": number,"updated_rows": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "column_mapping"?: NonNullable<Json>,"completed_at"?: string | null,"consent_source"?: string | null,"created_at"?: string,"created_by"?: string | null,"errors"?: NonNullable<Json>,"id"?: string,"inserted_rows"?: number,"list_id"?: string | null,"skipped_rows"?: number,"status"?: Database["public"]['Enums']["import_status"],"storage_path": string,"total_rows"?: number,"updated_rows"?: number,"workspace_id": string
                  }
                  Update: {
                    "column_mapping"?: NonNullable<Json>,"completed_at"?: string | null,"consent_source"?: string | null,"created_at"?: string,"created_by"?: string | null,"errors"?: NonNullable<Json>,"id"?: string,"inserted_rows"?: number,"list_id"?: string | null,"skipped_rows"?: number,"status"?: Database["public"]['Enums']["import_status"],"storage_path"?: string,"total_rows"?: number,"updated_rows"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "csv_imports_list_id_workspace_id_fkey"
      columns: ["list_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contact_lists"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "csv_imports_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"email_events": {
                  Row: {
                    "contact_id": string | null,"created_at": string,"detail": NonNullable<Json>,"event_type": Database["public"]['Enums']["email_event_type"],"id": string,"occurred_at": string,"provider_event_id": string,"send_id": string | null,"ses_message_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id"?: string | null,"created_at"?: string,"detail"?: NonNullable<Json>,"event_type": Database["public"]['Enums']["email_event_type"],"id"?: string,"occurred_at": string,"provider_event_id": string,"send_id"?: string | null,"ses_message_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "contact_id"?: string | null,"created_at"?: string,"detail"?: NonNullable<Json>,"event_type"?: Database["public"]['Enums']["email_event_type"],"id"?: string,"occurred_at"?: string,"provider_event_id"?: string,"send_id"?: string | null,"ses_message_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_events_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_events_send_id_fkey"
      columns: ["send_id"]
isOneToOne: false
      referencedRelation: "email_sends"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"email_sends": {
                  Row: {
                    "attempts": number,"bounced_at": string | null,"campaign_id": string | null,"clicked_at": string | null,"complained_at": string | null,"contact_id": string | null,"created_at": string,"delivered_at": string | null,"enrollment_id": string | null,"id": string,"kind": Database["public"]['Enums']["send_kind"],"last_error": string | null,"lease_until": string | null,"opened_at": string | null,"queued_at": string | null,"sent_at": string | null,"ses_message_id": string | null,"status": Database["public"]['Enums']["send_status"],"step_id": string | null,"to_email": string,"unsubscribed_at": string | null,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"bounced_at"?: string | null,"campaign_id"?: string | null,"clicked_at"?: string | null,"complained_at"?: string | null,"contact_id"?: string | null,"created_at"?: string,"delivered_at"?: string | null,"enrollment_id"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["send_kind"],"last_error"?: string | null,"lease_until"?: string | null,"opened_at"?: string | null,"queued_at"?: string | null,"sent_at"?: string | null,"ses_message_id"?: string | null,"status"?: Database["public"]['Enums']["send_status"],"step_id"?: string | null,"to_email": string,"unsubscribed_at"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "attempts"?: number,"bounced_at"?: string | null,"campaign_id"?: string | null,"clicked_at"?: string | null,"complained_at"?: string | null,"contact_id"?: string | null,"created_at"?: string,"delivered_at"?: string | null,"enrollment_id"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["send_kind"],"last_error"?: string | null,"lease_until"?: string | null,"opened_at"?: string | null,"queued_at"?: string | null,"sent_at"?: string | null,"ses_message_id"?: string | null,"status"?: Database["public"]['Enums']["send_status"],"step_id"?: string | null,"to_email"?: string,"unsubscribed_at"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_sends_campaign_id_workspace_id_fkey"
      columns: ["campaign_id","workspace_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "email_sends_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_sends_enrollment_id_workspace_id_fkey"
      columns: ["enrollment_id","workspace_id"]
isOneToOne: false
      referencedRelation: "sequence_enrollments"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "email_sends_step_id_workspace_id_fkey"
      columns: ["step_id","workspace_id"]
isOneToOne: false
      referencedRelation: "sequence_steps"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "email_sends_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"email_templates": {
                  Row: {
                    "category": string,"created_at": string,"html_body": string,"id": string,"name": string,"preview_text": string,"subject": string,"text_body": string,"updated_at": string,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string,"created_at"?: string,"html_body"?: string,"id"?: string,"name": string,"preview_text"?: string,"subject"?: string,"text_body"?: string,"updated_at"?: string,"workspace_id"?: string | null
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"html_body"?: string,"id"?: string,"name"?: string,"preview_text"?: string,"subject"?: string,"text_body"?: string,"updated_at"?: string,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_templates_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"full_name": string | null,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string | null,"id": string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string | null,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sender_domains": {
                  Row: {
                    "aws_region": string,"created_at": string,"dkim_status": Database["public"]['Enums']["domain_status"],"dns_records": NonNullable<Json>,"domain": string,"id": string,"last_checked_at": string | null,"mail_from_domain": string | null,"ses_identity_arn": string | null,"updated_at": string,"verification_status": Database["public"]['Enums']["domain_status"],"verified_at": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "aws_region": string,"created_at"?: string,"dkim_status"?: Database["public"]['Enums']["domain_status"],"dns_records"?: NonNullable<Json>,"domain": string,"id"?: string,"last_checked_at"?: string | null,"mail_from_domain"?: string | null,"ses_identity_arn"?: string | null,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["domain_status"],"verified_at"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "aws_region"?: string,"created_at"?: string,"dkim_status"?: Database["public"]['Enums']["domain_status"],"dns_records"?: NonNullable<Json>,"domain"?: string,"id"?: string,"last_checked_at"?: string | null,"mail_from_domain"?: string | null,"ses_identity_arn"?: string | null,"updated_at"?: string,"verification_status"?: Database["public"]['Enums']["domain_status"],"verified_at"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sender_domains_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"sequence_enrollments": {
                  Row: {
                    "completed_at": string | null,"contact_id": string,"enrolled_at": string,"id": string,"next_run_at": string | null,"next_step_position": number,"sequence_id": string,"status": Database["public"]['Enums']["enrollment_status"],"stopped_at": string | null,"stopped_reason": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"contact_id": string,"enrolled_at"?: string,"id"?: string,"next_run_at"?: string | null,"next_step_position"?: number,"sequence_id": string,"status"?: Database["public"]['Enums']["enrollment_status"],"stopped_at"?: string | null,"stopped_reason"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "completed_at"?: string | null,"contact_id"?: string,"enrolled_at"?: string,"id"?: string,"next_run_at"?: string | null,"next_step_position"?: number,"sequence_id"?: string,"status"?: Database["public"]['Enums']["enrollment_status"],"stopped_at"?: string | null,"stopped_reason"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sequence_enrollments_contact_id_workspace_id_fkey"
      columns: ["contact_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "sequence_enrollments_sequence_id_workspace_id_fkey"
      columns: ["sequence_id","workspace_id"]
isOneToOne: false
      referencedRelation: "sequences"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"sequence_steps": {
                  Row: {
                    "created_at": string,"delay_minutes": number,"html_body": string,"id": string,"position": number,"preview_text": string,"sequence_id": string,"subject": string,"text_body": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"delay_minutes"?: number,"html_body"?: string,"id"?: string,"position": number,"preview_text"?: string,"sequence_id": string,"subject"?: string,"text_body"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"delay_minutes"?: number,"html_body"?: string,"id"?: string,"position"?: number,"preview_text"?: string,"sequence_id"?: string,"subject"?: string,"text_body"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sequence_steps_sequence_id_workspace_id_fkey"
      columns: ["sequence_id","workspace_id"]
isOneToOne: false
      referencedRelation: "sequences"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"sequences": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"from_email": string | null,"from_name": string | null,"id": string,"name": string,"reply_to": string | null,"sender_domain_id": string | null,"status": Database["public"]['Enums']["sequence_status"],"trigger_list_id": string | null,"trigger_type": Database["public"]['Enums']["sequence_trigger"],"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"from_email"?: string | null,"from_name"?: string | null,"id"?: string,"name": string,"reply_to"?: string | null,"sender_domain_id"?: string | null,"status"?: Database["public"]['Enums']["sequence_status"],"trigger_list_id"?: string | null,"trigger_type"?: Database["public"]['Enums']["sequence_trigger"],"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"from_email"?: string | null,"from_name"?: string | null,"id"?: string,"name"?: string,"reply_to"?: string | null,"sender_domain_id"?: string | null,"status"?: Database["public"]['Enums']["sequence_status"],"trigger_list_id"?: string | null,"trigger_type"?: Database["public"]['Enums']["sequence_trigger"],"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sequences_sender_domain_id_workspace_id_fkey"
      columns: ["sender_domain_id","workspace_id"]
isOneToOne: false
      referencedRelation: "sender_domains"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "sequences_trigger_list_id_workspace_id_fkey"
      columns: ["trigger_list_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contact_lists"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "sequences_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"suppressions": {
                  Row: {
                    "created_at": string,"email": string,"id": string,"reason": Database["public"]['Enums']["suppression_reason"],"source": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"id"?: string,"reason": Database["public"]['Enums']["suppression_reason"],"source"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"reason"?: Database["public"]['Enums']["suppression_reason"],"source"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppressions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"tags": {
                  Row: {
                    "color": string | null,"created_at": string,"id": string,"name": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"created_at"?: string,"id"?: string,"name": string,"workspace_id": string
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tags_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"usage_records": {
                  Row: {
                    "metric": Database["public"]['Enums']["usage_metric"],"quantity": number,"usage_date": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "metric": Database["public"]['Enums']["usage_metric"],"quantity"?: number,"usage_date"?: string,"workspace_id": string
                  }
                  Update: {
                    "metric"?: Database["public"]['Enums']["usage_metric"],"quantity"?: number,"usage_date"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_records_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"webhook_inbox": {
                  Row: {
                    "attempts": number,"id": string,"last_error": string | null,"payload": NonNullable<Json>,"processed_at": string | null,"provider": string,"provider_message_id": string,"received_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"id"?: string,"last_error"?: string | null,"payload": NonNullable<Json>,"processed_at"?: string | null,"provider"?: string,"provider_message_id": string,"received_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"id"?: string,"last_error"?: string | null,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"provider"?: string,"provider_message_id"?: string,"received_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"workspace_members": {
                  Row: {
                    "created_at": string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["workspace_role"],"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_members_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"daily_send_limit": number,"default_from_email": string | null,"default_from_name": string | null,"default_reply_to": string | null,"id": string,"max_contacts": number,"monthly_ai_limit": number,"monthly_send_limit": number,"name": string,"owner_id": string,"postal_address": string | null,"sending_status": Database["public"]['Enums']["workspace_status"],"suspended_reason": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"daily_send_limit"?: number,"default_from_email"?: string | null,"default_from_name"?: string | null,"default_reply_to"?: string | null,"id"?: string,"max_contacts"?: number,"monthly_ai_limit"?: number,"monthly_send_limit"?: number,"name": string,"owner_id": string,"postal_address"?: string | null,"sending_status"?: Database["public"]['Enums']["workspace_status"],"suspended_reason"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"daily_send_limit"?: number,"default_from_email"?: string | null,"default_from_name"?: string | null,"default_reply_to"?: string | null,"id"?: string,"max_contacts"?: number,"monthly_ai_limit"?: number,"monthly_send_limit"?: number,"name"?: string,"owner_id"?: string,"postal_address"?: string | null,"sending_status"?: Database["public"]['Enums']["workspace_status"],"suspended_reason"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "campaign_stats": {
                  Row: {
                    "ambiguous": number | null,"bounced": number | null,"campaign_id": string | null,"clicked": number | null,"complained": number | null,"delivered": number | null,"failed": number | null,"in_progress": number | null,"opened": number | null,"sent": number | null,"skipped": number | null,"total": number | null,"unsubscribed": number | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "email_sends_campaign_id_workspace_id_fkey"
      columns: ["campaign_id","workspace_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "email_sends_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "claim_send":
{ Args: { "p_lease_seconds"?: number,"p_send_id": string }; Returns: Json
                           },
"complete_send":
{ Args: { "p_send_id": string,"p_ses_message_id": string }; Returns: undefined
                           },
"enqueue_campaign":
{ Args: { "p_campaign_id": string }; Returns: number
                           },
"enqueue_due_campaigns":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"enqueue_due_sequence_steps":
{ Args: { "p_limit"?: number }; Returns: number
                           },
"fail_send":
{ Args: { "p_error": string,"p_permanent": boolean,"p_send_id": string }; Returns: undefined
                           },
"finalize_campaigns":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"increment_usage":
{ Args: { "p_metric": Database["public"]['Enums']["usage_metric"],"p_qty"?: number,"p_workspace_id": string }; Returns: undefined
                           },
"mark_stale_sends_ambiguous":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"queue_archive":
{ Args: { "p_msg_id": number }; Returns: boolean
                           },
"queue_defer":
{ Args: { "p_delay_seconds": number,"p_msg_id": number }; Returns: undefined
                           },
"queue_delete":
{ Args: { "p_msg_id": number }; Returns: boolean
                           },
"queue_read":
{ Args: { "p_qty"?: number,"p_vt_seconds"?: number }; Returns: {
              "message": Json,"msg_id": number,"read_ct": number
            }[]
                           },
"record_email_event":
{ Args: { "p_detail"?: Json,"p_event_type": Database["public"]['Enums']["email_event_type"],"p_occurred_at": string,"p_permanent_bounce"?: boolean,"p_provider_event_id": string,"p_ses_message_id": string }; Returns: boolean
                           },
"unsubscribe_send":
{ Args: { "p_send_id": string,"p_source"?: string }; Returns: boolean
                           }
          }
          Enums: {
            "campaign_status": "draft"|"scheduled"|"sending"|"paused"|"sent"|"cancelled"|"failed","contact_status": "pending"|"subscribed"|"unsubscribed"|"bounced"|"complained","domain_status": "pending"|"verified"|"failed"|"temporary_failure"|"not_started","email_event_type": "send"|"delivery"|"bounce"|"complaint"|"reject"|"delivery_delay"|"open"|"click"|"unsubscribe"|"rendering_failure","enrollment_status": "active"|"completed"|"stopped","import_status": "uploaded"|"processing"|"completed"|"failed","send_kind": "campaign"|"sequence","send_status": "pending"|"queued"|"sending"|"sent"|"delivered"|"bounced"|"complained"|"failed"|"skipped"|"cancelled"|"ambiguous","sequence_status": "draft"|"active"|"paused"|"archived","sequence_trigger": "manual"|"list_join","suppression_reason": "unsubscribe"|"hard_bounce"|"complaint"|"manual","usage_metric": "emails_sent"|"ai_generations"|"contacts_imported","workspace_role": "owner"|"admin"|"member","workspace_status": "active"|"paused"|"suspended"
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
  "public": {
          Enums: {
            "campaign_status": ["draft", "scheduled", "sending", "paused", "sent", "cancelled", "failed"],"contact_status": ["pending", "subscribed", "unsubscribed", "bounced", "complained"],"domain_status": ["pending", "verified", "failed", "temporary_failure", "not_started"],"email_event_type": ["send", "delivery", "bounce", "complaint", "reject", "delivery_delay", "open", "click", "unsubscribe", "rendering_failure"],"enrollment_status": ["active", "completed", "stopped"],"import_status": ["uploaded", "processing", "completed", "failed"],"send_kind": ["campaign", "sequence"],"send_status": ["pending", "queued", "sending", "sent", "delivered", "bounced", "complained", "failed", "skipped", "cancelled", "ambiguous"],"sequence_status": ["draft", "active", "paused", "archived"],"sequence_trigger": ["manual", "list_join"],"suppression_reason": ["unsubscribe", "hard_bounce", "complaint", "manual"],"usage_metric": ["emails_sent", "ai_generations", "contacts_imported"],"workspace_role": ["owner", "admin", "member"],"workspace_status": ["active", "paused", "suspended"]
          }
        }
} as const
