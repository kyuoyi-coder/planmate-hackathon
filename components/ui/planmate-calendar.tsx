"use client";

import ShadcnBigCalendar from "../shadcn-big-calendar/shadcn-big-calendar";
import moment from "moment";
import { momentLocalizer } from "react-big-calendar";

const localizer = momentLocalizer(moment);
export default function Calendar() {
  return (
    <ShadcnBigCalendar
      localizer={localizer}
      style={{ height: 700 }}
      events={[]}
      // color events: return { className: "event-variant-primary" } (also -secondary, -outline)
      eventPropGetter={() => ({ className: "event-variant-primary" })}
    />
  );
}
