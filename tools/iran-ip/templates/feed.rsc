# EMS Iran IPv4 feed - RouterOS @MAJOR@ only. Generated from RIPEstat.
# RIPE snapshot: @SOURCE_ISO@ / @SOURCE_JALALI@ (Jalali)
# Published: @BUILD_JALALI@ Asia/Tehran. Content SHA256: @HASH@
# IR-IP_EMS is reserved for this updater. No firewall rules are changed.
{
    :global emsIRApplyBusy;
    :global emsIRImportOK;
    :if ($emsIRApplyBusy = true) do={ :error "EMS IR: another import is running"; }
    :set emsIRApplyBusy true;
    :set emsIRImportOK "";
    :local listName "IR-IP_EMS";
    :local stageName "IR-IP_EMS__stage";
    :local dataTag "EMS:IR:DATA";
    :local metaPrefix "EMS:IR:META|";
    :local metadata "@METADATA@";
    :local generation @GENERATION@;
    :local expected @COUNT@;
    :local addedIds [:toarray ""];
    :local removedAddresses [:toarray ""];
    :local enabledIds [:toarray ""];
    :local success false;
    :local problem "validation or apply failed; see preceding log";
    :do {
        :local version [/system resource get version];
        :if ([:pick $version 0 2] != "@MAJOR@.") do={
            :set problem "wrong RouterOS file: use the v@MAJOR@ file only on RouterOS @MAJOR@";
            :error $problem;
        }
        :local clockDate [/system clock get date];
        :local today 0;
        :if ([:pick $clockDate 4 5] = "-") do={
            :set today [:tonum ([:pick $clockDate 0 4] . [:pick $clockDate 5 7] . [:pick $clockDate 8 10])];
        } else={
            :local months {"jan"="01";"feb"="02";"mar"="03";"apr"="04";"may"="05";"jun"="06";"jul"="07";"aug"="08";"sep"="09";"oct"="10";"nov"="11";"dec"="12"};
            :local month ($months->[:pick $clockDate 0 3]);
            :set today [:tonum ([:pick $clockDate 7 11] . $month . [:pick $clockDate 4 6])];
        }
        :if (([:typeof $today] != "num") || ($today < @NOT_BEFORE@) || ($today > @NOT_AFTER@)) do={
            :set problem "file is stale or router date is wrong; old list kept";
            :error $problem;
        }
        :local metaIds [/ip firewall address-list find where list=$listName and address=1.1.2.7];
        :if ([:len $metaIds] > 1) do={ :error "EMS IR: duplicate metadata rows"; }
        :if ([:len $metaIds] = 1) do={
            :local previous [/ip firewall address-list get $metaIds comment];
            :if ([:pick $previous 0 [:len $metaPrefix]] != $metaPrefix) do={ :error "EMS IR: metadata address is occupied"; }
            :local separator [:find $previous "|" [:len $metaPrefix]];
            :local previousGeneration [:tonum [:pick $previous [:len $metaPrefix] $separator]];
            :if (([:typeof $previousGeneration] != "num") || ($previousGeneration > $generation)) do={
                :set problem "older/invalid generation refused; old list kept";
                :error $problem;
            }
        }
        :foreach item in=[/ip firewall address-list find where list=$listName] do={
            :local tag [/ip firewall address-list get $item comment];
            :local addr [:tostr [/ip firewall address-list get $item address]];
            :if (($tag != $dataTag) && !(($addr = "1.1.2.7") && ([:pick $tag 0 [:len $metaPrefix]] = $metaPrefix))) do={
                :set problem "foreign entries in IR-IP_EMS; move custom entries to a separate list";
                :error $problem;
            }
        }
        :set problem "prefix array validation failed";
        :local prefixes {
@PREFIXES@
        };
        :if ([:len $prefixes] != $expected) do={ :error "EMS IR: incomplete prefix array"; }
        :set problem "candidate staging failed";
        /ip firewall address-list remove [find where list=$stageName];
        :local wanted [:toarray ""];
        :foreach prefix in=$prefixes do={
            /ip firewall address-list add list=$stageName address=$prefix timeout=1h comment="EMS:IR:STAGE";
            :set ($wanted->$prefix) true;
        }
        :if ([:len [/ip firewall address-list find where list=$stageName]] != $expected) do={ :error "EMS IR: staging count mismatch"; }
        :set problem "withdrawal comparison failed";
        :local obsoleteIds [:toarray ""];
        :local currentByPrefix [:toarray ""];
        :foreach item in=[/ip firewall address-list find where list=$listName and comment=$dataTag] do={
            :local addr [:tostr [/ip firewall address-list get $item address]];
            :if ([:find $addr "/"] = nil) do={ :set addr ($addr . "/32"); }
            :if ([:typeof ($currentByPrefix->$addr)] != "nil") do={ :error "EMS IR: duplicate managed prefix"; }
            :set ($currentByPrefix->$addr) $item;
            :if (($wanted->$addr) != true) do={ :set obsoleteIds ($obsoleteIds, $item); }
        }
        # The complete candidate has been parsed and staged before touching live entries.
        :set problem "adding new prefixes failed";
        :foreach prefix in=$prefixes do={
            :local existing ($currentByPrefix->$prefix);
            :if ([:typeof $existing] = "nil") do={
                :local newId [/ip firewall address-list add list=$listName address=$prefix comment=$dataTag];
                :set addedIds ($addedIds, $newId);
            } else={
                :if ([/ip firewall address-list get $existing disabled]) do={
                    :set enabledIds ($enabledIds, $existing);
                    /ip firewall address-list set $existing disabled=no;
                }
            }
        }
        # Delete withdrawn prefixes only after every new prefix is in the live list.
        :set problem "removing withdrawn prefixes failed";
        :foreach item in=$obsoleteIds do={
            :local addr [/ip firewall address-list get $item address];
            :set removedAddresses ($removedAddresses, [:tostr $addr]);
            /ip firewall address-list remove $item;
        }
        :set problem "live count or metadata update failed";
        :if ([:len [/ip firewall address-list find where list=$listName and comment=$dataTag and disabled=no]] != $expected) do={ :error "EMS IR: live count mismatch"; }
        :if ([:len $metaIds] = 0) do={
            /ip firewall address-list add list=$listName address=1.1.2.7 disabled=yes comment=$metadata;
        } else={
            /ip firewall address-list set $metaIds disabled=yes comment=$metadata;
        }
        :set success true;
        :set emsIRImportOK [:tostr $generation];
        :log info ("EMS IR: updated " . $expected . " prefixes; Jalali @BUILD_JALALI@ Tehran");
    } on-error={
        # Undo our additions and restore withdrawn entries if an apply operation failed.
        :do {
            :foreach item in=$addedIds do={ /ip firewall address-list remove $item; }
            :foreach addr in=$removedAddresses do={
                :if ([:len [/ip firewall address-list find where list=$listName and address=$addr and comment=$dataTag]] = 0) do={
                    /ip firewall address-list add list=$listName address=$addr comment=$dataTag;
                }
            }
            :foreach item in=$enabledIds do={ /ip firewall address-list set $item disabled=yes; }
        } on-error={ :log error "EMS IR: rollback incomplete; retry update and inspect IR-IP_EMS"; }
        :log error ("EMS IR: " . $problem);
    }
    :do { /ip firewall address-list remove [find where list=$stageName]; } on-error={}
    :set emsIRApplyBusy false;
    :if (!$success) do={ :error ("EMS IR: " . $problem); }
}
# EMS-IR-END @GENERATION@ @HASH@
