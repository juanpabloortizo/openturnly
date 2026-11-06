import React, { useState, useEffect } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  RefreshCw,
  Search,
  User,
  Video,
  X,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { toast } from "./toast.tsx";
import { useAvailability } from "../lib/booking.ts";

export type ManageAppointment = {
  id: string;
  code: string;
  status: "confirmed" | "cancelled";
  date: string;
  time: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  resourceName: string | null;
  priceAmount: number | null;
  serviceId: string | null;
  resourceId: string | null;
  cancelledAt: string | null;
  customer: {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  };
};

export function ManageBookingModal({
  slug,
  initialCode = "",
  isOpen,
  onClose,
}: {
  slug: string;
  initialCode?: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [contact, setContact] = useState("");
  const [searching, setSearching] = useState(false);
  const [appointment, setAppointment] = useState<ManageAppointment | null>(null);
  const [businessInfo, setBusinessInfo] = useState<{
    name: string;
    address: string | null;
    meetingType: string;
    googleMeetUrl: string | null;
    phone: string | null;
    currency: string;
  } | null>(null);

  // Modo reagendamiento
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  // Modo cancelación
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
    }
  }, [initialCode]);

  // Consulta de disponibilidad si está reagendando
  const fromDate = new Date().toISOString().slice(0, 10);
  const toDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const availabilityQuery = useAvailability(
    slug,
    isRescheduling && appointment?.serviceId
      ? {
          locationId: null,
          serviceId: appointment.serviceId,
          resourceId: appointment.resourceId,
          from: fromDate,
          to: toDate,
        }
      : null,
  );

  const availableDays = availabilityQuery.data?.days ?? {};

  const handleLookup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!code.trim() || !contact.trim()) {
      toast.error("Ingresa el código de cita y tu teléfono o correo.");
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`/api/public/businesses/${slug}/appointments/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          contact: contact.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "No encontramos una cita con los datos ingresados.");
      }

      setAppointment(data.appointment);
      setBusinessInfo(data.business);
      setIsRescheduling(false);
      setIsCancelling(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al buscar la cita.");
    } finally {
      setSearching(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!appointment) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/public/businesses/${slug}/appointments/${appointment.code}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: contact.trim(),
          reason: cancelReason || "Cancelado por el cliente desde portal de autogestión",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Error al cancelar la cita.");
      }

      toast.success("Tu cita ha sido cancelada exitosamente.");
      setAppointment((prev) => (prev ? { ...prev, status: "cancelled", cancelledAt: new Date().toISOString() } : null));
      setIsCancelling(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cancelar la cita.");
    } finally {
      setCancelling(false);
    }
  };

  const handleConfirmReschedule = async () => {
    if (!appointment || !selectedDate || !selectedTime) {
      toast.error("Selecciona una fecha y hora disponible.");
      return;
    }
    setRescheduling(true);
    try {
      const res = await fetch(`/api/public/businesses/${slug}/appointments/${appointment.code}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: contact.trim(),
          date: selectedDate,
          time: selectedTime,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "El horario seleccionado ya no está disponible.");
      }

      toast.success("¡Tu cita ha sido reagendada con éxito!");
      setAppointment((prev) =>
        prev
          ? {
              ...prev,
              date: selectedDate,
              time: selectedTime,
              startsAt: data.appointment.startsAt,
              endsAt: data.appointment.endsAt,
            }
          : null,
      );
      setIsRescheduling(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al reagendar la cita.");
    } finally {
      setRescheduling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-6 sm:p-7 shadow-2xl border border-zinc-100 max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 text-zinc-400 hover:text-zinc-700 transition-colors cursor-pointer"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid size-10 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Calendar className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-950">Gestionar mi Cita</h3>
            <p className="text-xs text-zinc-500">Consulta tu reserva, cambia de horario o cancela tu turno.</p>
          </div>
        </div>

        {/* 1. Formulario de Búsqueda de Cita */}
        {!appointment ? (
          <form onSubmit={handleLookup} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Código de Reserva</label>
              <input
                type="text"
                placeholder="Ej: CFX-48K2"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-xs font-mono font-bold uppercase text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-600 focus:outline-hidden"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Teléfono o Correo Registrado
              </label>
              <input
                type="text"
                placeholder="Ej: 3001234567 o cliente@correo.com"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-600 focus:outline-hidden"
                required
              />
              <span className="text-[11px] text-zinc-400 mt-1 block">
                Por seguridad, debes ingresar el mismo dato con el que reservaste.
              </span>
            </div>

            <button
              type="submit"
              disabled={searching}
              className="w-full mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              {searching ? (
                <span>Buscando reserva...</span>
              ) : (
                <>
                  <Search className="size-4" />
                  <span>Consultar Cita</span>
                </>
              )}
            </button>
          </form>
        ) : (
          /* 2. Visualización y Acciones de la Cita */
          <div className="space-y-5 pt-2">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-indigo-700 bg-indigo-100/70 px-2.5 py-1 rounded-lg">
                  {appointment.code}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    appointment.status === "confirmed"
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                      : "bg-rose-100 text-rose-800 border border-rose-200"
                  }`}
                >
                  {appointment.status === "confirmed" ? (
                    <>
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                      <span>Confirmada</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="size-3.5 text-rose-600" />
                      <span>Cancelada</span>
                    </>
                  )}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Servicio:</span>
                  <span className="font-bold text-zinc-900">{appointment.serviceName}</span>
                </div>
                {appointment.resourceName && (
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Profesional:</span>
                    <span className="font-semibold text-zinc-800">{appointment.resourceName}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Fecha y Hora:</span>
                  <span className="font-bold text-zinc-900">
                    {appointment.date} a las {appointment.time}
                  </span>
                </div>
                {appointment.priceAmount !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Valor:</span>
                    <span className="font-bold text-zinc-900">
                      {appointment.priceAmount > 0
                        ? new Intl.NumberFormat("es-CO", {
                            style: "currency",
                            currency: businessInfo?.currency ?? "COP",
                            maximumFractionDigits: 0,
                          }).format(appointment.priceAmount)
                        : "Sin costo"}
                    </span>
                  </div>
                )}
              </div>

              {/* Enlace de Videollamada o Dirección */}
              {((appointment as any).meetingUri || businessInfo?.googleMeetUrl) && appointment.status === "confirmed" ? (
                <div className="pt-2 border-t border-zinc-200 flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-600 flex items-center gap-1">
                    <Video className="size-3.5 text-indigo-600" />
                    <span>
                      {(appointment as any).meetingProvider === "zoom"
                        ? "Zoom:"
                        : (appointment as any).meetingProvider === "teams"
                        ? "Microsoft Teams:"
                        : "Google Meet:"}
                    </span>
                  </span>
                  <a
                    href={(appointment as any).meetingUri || businessInfo?.googleMeetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline inline-flex items-center gap-1"
                  >
                    <span>Abrir Sala</span>
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              ) : appointment.status === "confirmed" ? (
                <div className="pt-2 border-t border-zinc-200 flex items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-600 flex items-center gap-1">
                    <MapPin className="size-3.5 text-emerald-600" />
                    <span>Modalidad:</span>
                  </span>
                  <span className="font-semibold text-zinc-800 truncate max-w-[200px]">
                    {businessInfo?.address ? `Presencial (${businessInfo.address})` : "Presencial en Sede"}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Sub-formulario de Reagendamiento */}
            {isRescheduling && (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                    <Clock className="size-4 text-indigo-600" />
                    <span>Selecciona tu nuevo horario</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => setIsRescheduling(false)}
                    className="text-xs text-zinc-500 hover:text-zinc-800 cursor-pointer"
                  >
                    Cerrar
                  </button>
                </div>

                {/* Días Disponibles */}
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-600 mb-1.5">Días con disponibilidad:</label>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {Object.keys(availableDays).length === 0 ? (
                      <span className="text-xs text-zinc-500 italic">Consultando disponibilidad...</span>
                    ) : (
                      Object.keys(availableDays).map((dayStr) => (
                        <button
                          key={dayStr}
                          type="button"
                          onClick={() => {
                            setSelectedDate(dayStr);
                            setSelectedTime("");
                          }}
                          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold border transition-all cursor-pointer ${
                            selectedDate === dayStr
                              ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                              : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
                          }`}
                        >
                          {dayStr.slice(5)}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Horas Disponibles para el día seleccionado */}
                {selectedDate && availableDays[selectedDate] && (
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-600 mb-1.5">Horas disponibles:</label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-36 overflow-y-auto">
                      {availableDays[selectedDate].map((tStr) => (
                        <button
                          key={tStr}
                          type="button"
                          onClick={() => setSelectedTime(tStr)}
                          className={`rounded-lg py-1.5 text-xs font-bold border transition-all cursor-pointer ${
                            selectedTime === tStr
                              ? "bg-emerald-600 text-white border-emerald-600"
                              : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
                          }`}
                        >
                          {tStr}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={rescheduling || !selectedDate || !selectedTime}
                  onClick={handleConfirmReschedule}
                  className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {rescheduling ? <span>Reagendando...</span> : <span>Confirmar Nuevo Horario</span>}
                </button>
              </div>
            )}

            {/* Sub-formulario de Cancelación */}
            {isCancelling && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 space-y-3">
                <div className="flex items-center gap-2 text-rose-800">
                  <AlertCircle className="size-4 shrink-0 text-rose-600" />
                  <span className="text-xs font-bold">¿Seguro que deseas cancelar esta cita?</span>
                </div>
                <p className="text-[11px] text-zinc-600">
                  El espacio quedará liberado en la agenda para otros clientes.
                </p>
                <input
                  type="text"
                  placeholder="Motivo de cancelación (opcional)"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:outline-hidden"
                />
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsCancelling(false)}
                    className="flex-1 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    disabled={cancelling}
                    onClick={handleConfirmCancel}
                    className="flex-1 py-2 rounded-xl bg-rose-600 text-xs font-bold text-white hover:bg-rose-700 shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {cancelling ? <span>Cancelando...</span> : <span>Sí, Cancelar Cita</span>}
                  </button>
                </div>
              </div>
            )}

            {/* Botones de Acción si la cita está confirmada y no se está editando */}
            {!isRescheduling && !isCancelling && (
              <div className="space-y-2 pt-1">
                {appointment.status === "confirmed" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsRescheduling(true);
                        setIsCancelling(false);
                      }}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-all cursor-pointer"
                    >
                      <RefreshCw className="size-3.5" />
                      <span>Reagendar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCancelling(true);
                        setIsRescheduling(false);
                      }}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 hover:bg-rose-100 transition-all cursor-pointer"
                    >
                      <XCircle className="size-3.5" />
                      <span>Cancelar</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-3 text-center bg-zinc-100 rounded-xl text-xs text-zinc-500">
                    Esta cita ya fue cancelada. Puedes agendar una nueva reserva en la página principal.
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setAppointment(null);
                    setIsRescheduling(false);
                    setIsCancelling(false);
                  }}
                  className="w-full text-center text-xs text-zinc-500 hover:text-zinc-800 py-1 transition-colors cursor-pointer"
                >
                  Consultar otra reserva
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
