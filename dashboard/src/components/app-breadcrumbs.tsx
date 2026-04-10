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
  // /projects/:id/canisters/:canisterId
  if (segments[0] === "projects" && segments[2] === "canisters" && segments[3]) {
    return { id: segments[1], canisterId: segments[3], deployId: undefined };
  }
  // /projects/:id/deploys/:deployId
  if (segments[0] === "projects" && segments[2] === "deploys" && segments[3]) {
    return { id: segments[1], canisterId: undefined, deployId: segments[3] };
  }
  // /projects/:id
  if (segments[0] === "projects" && segments[1]) {
    return { id: segments[1], canisterId: undefined, deployId: undefined };
  }
  return { id: undefined, canisterId: undefined, deployId: undefined };
}

export function AppBreadcrumbs() {
  const { pathname } = useLocation();
  const { id, canisterId, deployId } = parseRoute(pathname);

  // Only fetch project if we're on a project-related route
  const { data } = useProject(id ?? "");
  const projectName = data?.project?.name;
  const canisterName = canisterId
    ? data?.project?.canisters?.find((c) => c.id === canisterId)?.name
    : undefined;

  if (pathname === "/billing") {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Billing</BreadcrumbPage>
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

  // /projects/:id/canisters/:canisterId
  if (id && canisterId) {
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
            <BreadcrumbPage>{canisterName ?? "Canister"}</BreadcrumbPage>
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
