// react-big-calendar ships its built-in agenda view without type declarations.
declare module "react-big-calendar/lib/Agenda" {
  import type { ComponentType } from "react";

  const Agenda: ComponentType<{ date: Date; length?: number; [prop: string]: unknown }>;
  export default Agenda;
}
