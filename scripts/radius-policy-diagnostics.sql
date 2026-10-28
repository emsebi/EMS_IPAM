-- Read-only, narrowly scoped authorization diagnosis. No credentials, raw
-- usernames, NAS addresses, tenant names or audit detail are selected.
-- The lookup hashes are filters, not a substitute for access control.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH account AS (
 SELECT * FROM radius_ops_accounts WHERE md5(username) = :'account_key'
), source AS (
 SELECT sourceipaddress::inet AS ip, authdate, reply
 FROM radpostauth
 WHERE md5(username) = :'account_key' AND md5(sourceipaddress) = :'source_key'
 ORDER BY authdate DESC,id DESC LIMIT 1
), selected_nas AS (
 SELECT n.* FROM source s CROSS JOIN LATERAL radius_ops_resolve_nas(s.ip) n
), effective AS (
 SELECT r.*,g.name='Default Read-Only' AS default_profile
 FROM account a CROSS JOIN source s
 CROSS JOIN LATERAL radius_ops_resolve_access(a.username,s.ip) r
 JOIN radius_ops_groups g ON g.id=r.profile_id
), rules AS (
 SELECT ar.id,ar.collection_id,ar.profile_id,ar.enabled AS rule_enabled,
        col.enabled AS collection_enabled,col.name='Default NAS' AS default_collection,
        g.enabled AS profile_enabled,g.name='Default Read-Only' AS default_profile,
        g.cisco_privilege,g.mikrotik_group,
        EXISTS(SELECT 1 FROM radius_ops_collection_devices cd
               JOIN selected_nas n ON n.device_id=cd.device_id
               WHERE cd.collection_id=ar.collection_id) AS includes_selected_nas
 FROM account a JOIN radius_ops_access_rules ar ON ar.account_id=a.id
 JOIN radius_ops_collections col ON col.id=ar.collection_id
 JOIN radius_ops_groups g ON g.id=ar.profile_id
), safe_replies AS (
 SELECT 'user' AS origin,attribute,op,value
 FROM radreply WHERE username IN (SELECT username FROM account)
 AND attribute IN ('Mikrotik-Group','Cisco-AVPair')
 UNION ALL
 SELECT 'legacy-group',r.attribute,r.op,r.value
 FROM radusergroup u JOIN radgroupreply r ON r.groupname=u.groupname
 WHERE u.username IN (SELECT username FROM account)
 AND r.attribute IN ('Mikrotik-Group','Cisco-AVPair')
), related_entities AS (
 SELECT id::text AS id FROM account
 UNION SELECT profile_id::text FROM rules
 UNION SELECT collection_id::text FROM rules
 UNION SELECT device_id::text FROM selected_nas
)
SELECT jsonb_pretty(jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'account',(SELECT jsonb_build_object('enabled',enabled,'created_at',created_at,
   'legacy_vendor',vendor,'legacy_cisco_privilege',privilege,
   'legacy_mikrotik_group',mikrotik_group,'has_legacy_group',group_id IS NOT NULL) FROM account),
 'last_matching_auth',(SELECT jsonb_build_object('at',authdate,'reply',reply) FROM source),
 'nas',(SELECT jsonb_build_object('active',active,'prefix_length',masklen(nas_ip)) FROM selected_nas),
 'effective',(SELECT jsonb_agg(jsonb_build_object('default_collection',collection_name='Default NAS',
   'default_profile',default_profile,'cisco_privilege',cisco_privilege,'mikrotik_group',mikrotik_group,
   'profile_ref',md5(profile_id::text),'collection_ref',md5(collection_id::text))) FROM effective),
 'rules',(SELECT jsonb_agg(jsonb_build_object('rule_enabled',rule_enabled,
   'collection_enabled',collection_enabled,'profile_enabled',profile_enabled,
   'default_collection',default_collection,'default_profile',default_profile,
   'cisco_privilege',cisco_privilege,'mikrotik_group',mikrotik_group,
   'includes_selected_nas',includes_selected_nas,
   'profile_ref',md5(profile_id::text),'collection_ref',md5(collection_id::text))) FROM rules),
 'static_replies',(SELECT jsonb_agg(to_jsonb(safe_replies)) FROM safe_replies),
 'recent_changes',(SELECT jsonb_agg(to_jsonb(x)) FROM (
   SELECT action,entity_type,md5(entity_id) AS entity_ref,created_at
   FROM audit_log WHERE entity_id IN (SELECT id FROM related_entities)
   AND created_at >= now()-interval '14 days'
   ORDER BY created_at DESC LIMIT 40
 ) x)
));
ROLLBACK;
