import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import CustomerLayout from "../components/layout/CustomerLayout";
import ProviderLayout from "../components/layout/ProviderLayout";
import AdminLayout from "../components/layout/AdminLayout";

import ProtectedRoute from "./ProtectedRoute";

// Each page is its own chunk, loaded when first visited.
const MyBookings = lazy(() => import("../pages/customer/MyBookings"));
const Reviews = lazy(() => import("../pages/customer/Reviews"));
const ProviderVenues = lazy(() => import("../pages/provider/ProviderVenues"));
const VenueEditor = lazy(() => import("../pages/provider/VenueEditor"));
const VenueSchedule = lazy(() => import("../pages/provider/VenueSchedule"));
const VenuePricing = lazy(() => import("../pages/provider/VenuePricing"));
const ProviderReviews = lazy(() => import("../pages/provider/ProviderReviews"));
const ProviderAnalytics = lazy(() => import("../pages/provider/ProviderAnalytics"));
const ProviderEarnings = lazy(() => import("../pages/provider/ProviderEarnings"));
const AdminPayments = lazy(() => import("../pages/admin/AdminPayments"));
const Favorites = lazy(() => import("../pages/customer/Favorites"));
const BookingDetail = lazy(() => import("../pages/customer/BookingDetail"));
const InviteResponse = lazy(() => import("../pages/InviteResponse"));
const ProviderCheckIn = lazy(() => import("../pages/provider/ProviderCheckIn"));
const BrowseVenues = lazy(() => import("../pages/customer/BrowseVenues"));
const VenueDetails = lazy(() => import("../pages/customer/VenueDetails"));
const ProviderTimeSlots = lazy(() => import("../pages/provider/ProviderTimeSlots"));
const ProviderBookings = lazy(() => import("../pages/provider/ProviderBookings"));
const ProviderCalendar = lazy(() => import("../pages/provider/ProviderCalendar"));
const AdminUsers = lazy(() => import("../pages/admin/AdminUsers"));
const AdminProviders = lazy(() => import("../pages/admin/AdminProviders"));
const AdminBookings = lazy(() => import("../pages/admin/AdminBookings"));
const AdminAnalytics = lazy(() => import("../pages/admin/AdminAnalytics"));
const AdminUserDetail = lazy(() => import("../pages/admin/AdminUserDetail"));
const AdminVenues = lazy(() => import("../pages/admin/AdminVenues"));
const AdminReviews = lazy(() => import("../pages/admin/AdminReviews"));
const AdminCoupons = lazy(() => import("../pages/admin/AdminCoupons"));
const AdminAuditLog = lazy(() => import("../pages/admin/AdminAuditLog"));
const AdminSettings = lazy(() => import("../pages/admin/AdminSettings"));
const Login = lazy(() => import("../pages/auth/Login"));
const Register = lazy(() => import("../pages/auth/Register"));
const VerifyEmail = lazy(() => import("../pages/auth/VerifyEmail"));
const ForgotPassword = lazy(() => import("../pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("../pages/auth/ResetPassword"));
const Profile = lazy(() => import("../pages/account/Profile"));
const Notifications = lazy(() => import("../pages/account/Notifications"));
const CustomerDashboard = lazy(() => import("../pages/customer/CustomerDashboard"));
const ProviderDashboard = lazy(() => import("../pages/provider/ProviderDashboard"));
const AdminDashboard = lazy(() => import("../pages/admin/AdminDashboard"));

function AppRoutes() {
  return (
    // Pages inside the app shell show their own fallback (see AppShell);
    // this one only covers the sign-in pages.
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invites/:token" element={<InviteResponse />} />

      {/* Customer routes */}
      <Route element={<ProtectedRoute allowedRoles={["USER"]} />}>
        <Route path="/customer" element={<CustomerLayout />}>
          <Route index element={<CustomerDashboard />} />
          <Route path="venues" element={<BrowseVenues />} />
          <Route path="venues/:id" element={<VenueDetails />} />
          <Route path="bookings" element={<MyBookings />} />
          <Route path="bookings/:id" element={<BookingDetail />} />
          <Route path="favorites" element={<Favorites />} />
          <Route path="reviews" element={<Reviews />} />
          <Route path="profile" element={<Profile />} />
          <Route path="notifications" element={<Notifications />} />
        </Route>
      </Route>

      
      {/* Provider routes */}
<Route element={<ProtectedRoute allowedRoles={["PROVIDER"]} />}>
  <Route path="/provider" element={<ProviderLayout />}>
    <Route index element={<ProviderDashboard />} />
    <Route path="venues" element={<ProviderVenues />} />
    <Route path="venues/new" element={<VenueEditor />} />
    <Route path="venues/:id/edit" element={<VenueEditor />} />
    <Route path="venues/:id/schedule" element={<VenueSchedule />} />
    <Route path="venues/:id/pricing" element={<VenuePricing />} />
    <Route path="reviews" element={<ProviderReviews />} />
    <Route path="analytics" element={<ProviderAnalytics />} />
    <Route path="earnings" element={<ProviderEarnings />} />
    <Route path="check-in" element={<ProviderCheckIn />} />
    <Route path="time-slots" element={<ProviderTimeSlots />} />
    <Route path="bookings" element={<ProviderBookings />} />
    <Route path="calendar" element={<ProviderCalendar />} />
    <Route path="profile" element={<Profile />} />
    <Route path="notifications" element={<Notifications />} />
  </Route>
</Route>

      {/* Admin routes */}
      <Route element={<ProtectedRoute allowedRoles={["ADMIN"]} />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:id" element={<AdminUserDetail />} />
          <Route path="venues" element={<AdminVenues />} />
          <Route path="providers" element={<AdminProviders />} />
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="reviews" element={<AdminReviews />} />
          <Route path="coupons" element={<AdminCoupons />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="audit" element={<AdminAuditLog />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="profile" element={<Profile />} />
          <Route path="notifications" element={<Notifications />} />
        </Route>
      </Route>

      {/* Unknown route */}
      <Route
        path="*"
        element={<Navigate to="/login" replace />}
      />
    </Routes>
    </Suspense>
  );
}

export default AppRoutes;