// Tipo de cliente Supabase compartilhado pelas Edge Functions.
//
// Nas Edge Functions usamos o cliente service_role sem schema tipado
// (createClient sem genérico Database). As versões recentes de
// @supabase/supabase-js inferem o schema como `never` quando o genérico
// não é informado, o que quebra inserts/updates e a passagem do cliente
// entre módulos. Como já tipamos manualmente cada resultado de query
// (via `.single<T>()` e interfaces de linha), adotamos um cliente "solto"
// como contrato único — evitando casts repetidos espalhados pelo código.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
export type DbClient = SupabaseClient<any, any, any>;
