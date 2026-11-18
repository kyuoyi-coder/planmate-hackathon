"use client";

import moment from "moment";
import type { ComponentProps } from "react";
import type { NavigateAction } from "react-big-calendar";
import Agenda from "react-big-calendar/lib/Agenda";

const startOfMonth = (date: Date) => moment(date).startOf("month").toDate();

/**
 * The agenda for one calendar month, from the 1st to the last day.
 * The library's own agenda shows a rolling 30 days from the selected date,
 * so it straddles two months; this pins it to the month instead.
 */
function MonthAgenda(props: ComponentProps<typeof Agenda>) {
  // The built-in agenda lists `date` through `date + length` inclusive.
  return (
    <Agenda
      {...props}
      date={startOfMonth(props.date)}
      length={moment(props.date).daysInMonth() - 1}
    />
  );
}

MonthAgenda.range = (date: Date) => ({
  start: startOfMonth(date),
  end: moment(date).endOf("month").toDate(),
});

MonthAgenda.navigate = (date: Date, action: NavigateAction) => {
  if (action === "PREV") return moment(date).subtract(1, "month").toDate();
  if (action === "NEXT") return moment(date).add(1, "month").toDate();
  return date;
};

MonthAgenda.title = (date: Date) => moment(date).format("MMMM YYYY");

export default MonthAgenda;
