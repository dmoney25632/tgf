import { redirect } from "next/navigation";

/** The lobby is home now: old /dashboard links land in it. */
export default function DashboardPage() {
  redirect("/play/iron-horizon");
}
