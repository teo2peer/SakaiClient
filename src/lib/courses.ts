import type { CoursePreference, SakaiCourse } from '@/types/sakai';

export function courseAlias(preferences: Record<string, CoursePreference>, courseId: string): string | undefined {
  const alias = preferences[courseId]?.alias?.trim().slice(0, 120);
  return alias || undefined;
}

export function courseDisplayTitle(course: SakaiCourse, preferences: Record<string, CoursePreference>): string {
  return courseAlias(preferences, course.id) ?? course.title;
}

export function orderedCourses(
  courses: SakaiCourse[],
  order: string[],
  preferences: Record<string, CoursePreference>,
): SakaiCourse[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return courses.map((course, index) => ({ course, index })).sort((left, right) => {
    const favorite = Number(Boolean(preferences[right.course.id]?.favorite)) - Number(Boolean(preferences[left.course.id]?.favorite));
    if (favorite) return favorite;
    return (positions.get(left.course.id) ?? order.length + left.index) - (positions.get(right.course.id) ?? order.length + right.index);
  }).map(({ course }) => course);
}

export function moveCourseInOrder(
  courses: SakaiCourse[],
  order: string[],
  preferences: Record<string, CoursePreference>,
  courseId: string,
  direction: 'up' | 'down',
): string[] {
  const visible = orderedCourses(courses, order, preferences);
  const favorite = Boolean(preferences[courseId]?.favorite);
  const group = visible.filter((course) => Boolean(preferences[course.id]?.favorite) === favorite);
  const index = group.findIndex((course) => course.id === courseId);
  const other = group[index + (direction === 'up' ? -1 : 1)];
  if (index < 0 || !other) return [...new Set([...order, ...courses.map((course) => course.id)])];
  const complete = [...new Set([...visible.map((course) => course.id), ...order])];
  const first = complete.indexOf(courseId);
  const second = complete.indexOf(other.id);
  [complete[first], complete[second]] = [complete[second], complete[first]];
  return complete;
}

export function canMoveCourse(
  courses: SakaiCourse[],
  order: string[],
  preferences: Record<string, CoursePreference>,
  courseId: string,
  direction: 'up' | 'down',
): boolean {
  const favorite = Boolean(preferences[courseId]?.favorite);
  const group = orderedCourses(courses, order, preferences).filter(
    (course) => Boolean(preferences[course.id]?.favorite) === favorite,
  );
  const index = group.findIndex((course) => course.id === courseId);
  return index >= 0 && (direction === 'up' ? index > 0 : index < group.length - 1);
}
