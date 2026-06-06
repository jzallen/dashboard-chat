/* /org — organization settings. A real history entry now (retires the old
   beforeOrgRef toggle-state); Back leaves it via useNavIntents().toggleOrg. */
import { useTheme } from "../../src/app/AppShell/ThemeProvider";
import { OrgSettings } from "../../src/app/OrgSettings";

export default function OrgRoute() {
  const { dark, toggleDark } = useTheme();
  return <OrgSettings dark={dark} onToggleDark={toggleDark} />;
}
