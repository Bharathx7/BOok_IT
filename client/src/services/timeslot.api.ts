import api from "./api";

export interface TimeSlot {
  id: string;
  venueId: string;
  startTime: string;
  endTime: string;
}

interface GetTimeSlotsResponse {
  timeSlots: TimeSlot[];
}

export const getVenueTimeSlots = async (
  venueId: string
): Promise<TimeSlot[]> => {
  const response = await api.get<GetTimeSlotsResponse>(
    `/timeslots/venue/${venueId}`
  );

  return response.data.timeSlots;
};

export interface CreateTimeSlotRequest {
  venueId: string;
  startTime: string;
  endTime: string;
}

export const createTimeSlot = async (
  data: CreateTimeSlotRequest
): Promise<TimeSlot> => {
  const response = await api.post<{ timeSlot: TimeSlot }>(
    "/timeslots",
    data
  );

  return response.data.timeSlot;
};

export interface UpdateTimeSlotRequest {
  startTime: string;
  endTime: string;
}

export const updateTimeSlot = async (
  timeSlotId: string,
  data: UpdateTimeSlotRequest
): Promise<TimeSlot> => {
  const response = await api.put<{ timeSlot: TimeSlot }>(
    `/timeslots/${timeSlotId}`,
    data
  );

  return response.data.timeSlot;
};

export const deleteTimeSlot = async (
  timeSlotId: string
): Promise<void> => {
  await api.delete(`/timeslots/${timeSlotId}`);
};