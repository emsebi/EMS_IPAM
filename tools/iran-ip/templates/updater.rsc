# Run this script as an administrator, or install it with install-update.rsc.
{
    :global emsIRFetchBusy;
    :global emsIRImportOK;
    :if ($emsIRFetchBusy = true) do={ :error "EMS IR: an update is already running"; }
    :if ([:len [/system script job find where script="IR-IP_EMS-update"]] > 1) do={ :error "EMS IR: duplicate update job"; }
    :set emsIRFetchBusy true;
    :local fileName "IR-IP_EMS-download.rsc";
    :local success false;
    :do {
        :local version [/system resource get version];
        :local major [:pick $version 0 1];
        :if (($major != "6") && ($major != "7")) do={ :error "EMS IR: RouterOS 6 or 7 required"; }
        :local base "https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/feeds/iran/IR-IP_EMS-v";
        :for attempt from=1 to=3 do={
            :if (!$success) do={
                :do {
                    /file remove [find where name=$fileName];
                    :local info [/tool fetch url=($base . $major . ".bytes") check-certificate=yes output=user as-value];
                    :local expectedSize [:tonum ($info->"data")];
                    :if (([:typeof $expectedSize] != "num") || ($expectedSize < 10000) || ($expectedSize > 1000000)) do={ :error "EMS IR: invalid size manifest"; }
                    /tool fetch url=($base . $major . ".rsc") check-certificate=yes dst-path=$fileName;
                    :if ([/file get [find where name=$fileName] size] != $expectedSize) do={ :error "EMS IR: download is incomplete or publication changed; retrying"; }
                    :set emsIRImportOK "";
                    /import file-name=$fileName;
                    :if ([:len $emsIRImportOK] = 0) do={ :error "EMS IR: import did not complete"; }
                    :set success true;
                } on-error={ :log warning ("EMS IR: attempt " . $attempt . " failed; check HTTPS, certificates, router clock and preceding log"); }
                :if ((!$success) && ($attempt < 3)) do={ :delay 3s; }
            }
        }
    } on-error={ :log error "EMS IR: updater failed before download"; }
    :do { /file remove [find where name=$fileName]; } on-error={}
    :set emsIRFetchBusy false;
    :if (!$success) do={ :error "EMS IR: update failed; inspect Log. Successful-update date was not advanced."; }
}
