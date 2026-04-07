import { useLocation, Link } from "react-router-dom"
import { useProject } from "@/hooks/use-project"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

// useParams() doesn't work here because breadcrumbs render outside <Routes>.
// Parse route segments from pathname instead.
function parseRoute(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  // /projects/:id/deploys/:deployId
  if (segments[0] === "projects" && segments[2] === "deploys" && segments[3]) {
    return { id: segments[1], deployId: segments[3], buildId: undefined };
  }
  // /projects/:id/builds/:buildId
  if (segments[0] === "projects" && segments[2] === "builds" && segments[3]) {
    return { id: segments[1], deployId: undefined, buildId: segments[3] };
  }
  // /projects/:id
  if (segments[0] === "projects" && segments[1]) {
    return { id: segments[1], deployId: undefined, buildId: undefined };
  }
  return { id: undefined, deployId: undefined, buildId: undefined };
}

export function AppBreadcrumbs() {
  const { pathname } = useLocation();
  const { id, deployId, buildId } = parseRoute(pathname);

  // Only fetch project if we're on a project-related route
  const { data } = useProject(id ?? "");
  const projectName = data?.project?.name;

  if (pathname === "/settings") {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Settings</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  if (pathname === "/projects") {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Projects</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // /projects/:id/deploys/:deployId
  if (id && deployId) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/projects">Projects</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/projects/${id}`}>{projectName ?? "Project"}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Deploy #{deployId.slice(0, 8)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // /projects/:id/builds/:buildId
  if (id && buildId) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/projects">Projects</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/projects/${id}`}>{projectName ?? "Project"}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Build #{buildId.slice(0, 8)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // /projects/:id
  if (id) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/projects">Projects</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{projectName ?? "Project"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return null;
}
