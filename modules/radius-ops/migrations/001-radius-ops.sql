-- Isolated operational FreeRADIUS SQL schema. Existing EMS-IPAM tables unchanged.
CREATE TABLE IF NOT EXISTS nas(id bigserial PRIMARY KEY,nasname varchar(128) NOT NULL UNIQUE,shortname varchar(64) NOT NULL UNIQUE,type varchar(30) DEFAULT 'other',ports integer,secret varchar(255) NOT NULL,server varchar(64),community varchar(50),description varchar(200));
CREATE TABLE IF NOT EXISTS radcheck(id bigserial PRIMARY KEY,username varchar(64) NOT NULL,attribute varchar(64) NOT NULL,op char(2) NOT NULL DEFAULT ':=',value varchar(255) NOT NULL);
CREATE INDEX IF NOT EXISTS radcheck_user_idx ON radcheck(username);
CREATE TABLE IF NOT EXISTS radreply(id bigserial PRIMARY KEY,username varchar(64) NOT NULL,attribute varchar(64) NOT NULL,op char(2) NOT NULL DEFAULT ':=',value varchar(255) NOT NULL);
CREATE INDEX IF NOT EXISTS radreply_user_idx ON radreply(username);
CREATE TABLE IF NOT EXISTS radgroupcheck(id bigserial PRIMARY KEY,groupname varchar(64) NOT NULL,attribute varchar(64) NOT NULL,op char(2) NOT NULL DEFAULT ':=',value varchar(255) NOT NULL);
CREATE TABLE IF NOT EXISTS radgroupreply(id bigserial PRIMARY KEY,groupname varchar(64) NOT NULL,attribute varchar(64) NOT NULL,op char(2) NOT NULL DEFAULT ':=',value varchar(255) NOT NULL);
CREATE TABLE IF NOT EXISTS radusergroup(username varchar(64) NOT NULL,groupname varchar(64) NOT NULL,priority integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS radpostauth(id bigserial PRIMARY KEY,username varchar(64) NOT NULL,pass varchar(255) NOT NULL DEFAULT '',reply varchar(32) NOT NULL,authdate timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS radpostauth_time_idx ON radpostauth(authdate DESC);
CREATE TABLE IF NOT EXISTS radacct(radacctid bigserial PRIMARY KEY,acctsessionid varchar(64) NOT NULL,acctuniqueid varchar(32) NOT NULL UNIQUE,username varchar(64) NOT NULL,realm varchar(64),nasipaddress varchar(45) NOT NULL,nasportid varchar(32),nasporttype varchar(32),acctstarttime timestamp,acctupdatetime timestamp,acctstoptime timestamp,acctinterval bigint,acctsessiontime bigint,acctauthentic varchar(32),connectinfo_start varchar(50),connectinfo_stop varchar(50),acctinputoctets bigint,acctoutputoctets bigint,calledstationid varchar(50),callingstationid varchar(50),acctterminatecause varchar(32),servicetype varchar(32),framedprotocol varchar(32),framedipaddress varchar(45),framedipv6address varchar(45),framedipv6prefix varchar(45),framedinterfaceid varchar(44),delegatedipv6prefix varchar(45),class varchar(64));
CREATE INDEX IF NOT EXISTS radacct_time_idx ON radacct(acctstarttime DESC);
CREATE TABLE IF NOT EXISTS radius_ops_devices(id uuid PRIMARY KEY,host_id text NOT NULL UNIQUE REFERENCES hosts(id) ON DELETE RESTRICT,company_id text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,nas_ip inet NOT NULL UNIQUE,label varchar(120) NOT NULL,vendor varchar(20) NOT NULL CHECK(vendor IN('cisco-legacy','cisco-ios','mikrotik','other')),secret varchar(255) NOT NULL,enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS radius_ops_accounts(id uuid PRIMARY KEY,company_id text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,username varchar(64) NOT NULL UNIQUE,label varchar(120) NOT NULL,vendor varchar(20) NOT NULL CHECK(vendor IN('cisco','mikrotik','generic')),privilege smallint NOT NULL DEFAULT 1 CHECK(privilege BETWEEN 0 AND 15),mikrotik_group varchar(32) NOT NULL DEFAULT 'read',enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS radius_ops_macs(id uuid PRIMARY KEY,company_id text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,mac macaddr NOT NULL UNIQUE,label varchar(120) NOT NULL,vlan smallint CHECK(vlan BETWEEN 1 AND 4094),enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS radius_ops_mac_aliases(alias varchar(64) PRIMARY KEY,mac_id uuid NOT NULL REFERENCES radius_ops_macs(id) ON DELETE CASCADE);
-- Only the actual UDP source IP identifies the NAS; NAS-IP-Address from a request is not trusted.
CREATE OR REPLACE FUNCTION radius_ops_identity_allowed(identity text,source_ip inet) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM radius_ops_devices d WHERE d.enabled AND d.nas_ip=source_ip AND (
  EXISTS(SELECT 1 FROM radius_ops_accounts a WHERE a.company_id=d.company_id AND a.username=identity AND a.enabled)
  OR EXISTS(SELECT 1 FROM radius_ops_mac_aliases al JOIN radius_ops_macs m ON m.id=al.mac_id WHERE al.alias=identity AND m.company_id=d.company_id AND m.enabled)
 ));
$$;
